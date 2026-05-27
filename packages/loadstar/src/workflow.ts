import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type {
  AgentDefinition,
  AgentEvent,
  ConversationStore,
  LoadstarBindings,
  Message,
  ToolCall,
  ToolResult,
  TraceStore,
  WorkflowPayload,
} from "./types.js";

interface InferenceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

interface InferenceResponse {
  choices: {
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

type WorkflowClass = typeof WorkflowEntrypoint<
  LoadstarBindings,
  WorkflowPayload
>;

export function createAgentWorkflow(
  agents: Map<string, AgentDefinition>,
  storeFactory: (env: LoadstarBindings) => ConversationStore,
  traceStoreFactory?: (env: LoadstarBindings) => TraceStore
): WorkflowClass {
  return class AgentWorkflow extends WorkflowEntrypoint<
    LoadstarBindings,
    WorkflowPayload
  > {
    async run(
      event: Readonly<WorkflowEvent<WorkflowPayload>>,
      step: WorkflowStep
    ) {
      const { agentName, conversationId, message, relayId } = event.payload;

      const agentDef = agents.get(agentName);
      if (!agentDef) throw new Error(`Unknown agent: ${agentName}`);

      const store = storeFactory(this.env);
      const traces = traceStoreFactory?.(this.env);

      const traceId = crypto.randomUUID();
      const rootSpanId = crypto.randomUUID();

      if (traces) {
        await step.do("trace-init", async () => {
          await traces.createTrace({
            traceId,
            conversationId,
            agentName,
            startedAt: new Date().toISOString(),
            input: message,
          });
          await traces.createSpan({
            spanId: rootSpanId,
            traceId,
            parentSpanId: null,
            name: `agent:${agentName}`,
            kind: "workflow",
            status: "running",
            startedAt: new Date().toISOString(),
            attributes: { agentName, conversationId, model: agentDef.model },
            input: message,
            output: null,
            error: null,
          });
        });
      }

      try {
        const result = await this.runAgent(
          step,
          agentDef,
          store,
          traces,
          traceId,
          rootSpanId,
          conversationId,
          agentName,
          message,
          relayId
        );

        if (traces) {
          await step.do("trace-end-ok", async () => {
            await traces.endSpan(rootSpanId, "ok", result.response);
            await traces.endTrace(traceId, "ok");
          });
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorStack =
          err instanceof Error ? err.stack ?? errorMsg : errorMsg;
        if (traces) {
          await step.do("trace-end-error", async () => {
            await traces.endSpan(rootSpanId, "error", null, errorStack);
            await traces.endTrace(traceId, "error", errorStack);
          });
        }
        throw err;
      }
    }

    private async runAgent(
      step: WorkflowStep,
      agentDef: AgentDefinition,
      store: ConversationStore,
      traces: TraceStore | undefined,
      traceId: string,
      rootSpanId: string,
      conversationId: string,
      agentName: string,
      message: string,
      relayId: string | undefined
    ) {
      const persistSpanId = crypto.randomUUID();
      await this.traced(step, traces, "persist-user-message", {
        traceId,
        parentSpanId: rootSpanId,
        spanId: persistSpanId,
        kind: "persist",
        input: JSON.stringify({ role: "user", content: message }),
        attributes: { operation: "addMessage", role: "user" },
        fn: async () => {
          await store.addMessage(conversationId, {
            conversationId,
            role: "user",
            content: message,
          });
          return "ok";
        },
      });

      const history = await this.traced(step, traces, "load-history", {
        traceId,
        parentSpanId: rootSpanId,
        spanId: crypto.randomUUID(),
        kind: "persist",
        input: conversationId,
        attributes: { operation: "getMessages" },
        fn: async () => store.getMessages(conversationId),
      });

      let system: string;
      if (typeof agentDef.system === "function") {
        system = await this.traced(
          step,
          traces,
          "resolve-system-prompt",
          {
            traceId,
            parentSpanId: rootSpanId,
            spanId: crypto.randomUUID(),
            kind: "system",
            input: null,
            attributes: { dynamic: true },
            fn: async () =>
              (agentDef.system as Function)({
                conversationId,
                env: this.env,
              }),
          }
        );
      } else {
        system = agentDef.system;
      }

      const inferenceMessages = buildMessages(system, history);
      let turnCount = 0;
      const maxTurns = agentDef.maxTurns ?? 10;

      while (turnCount < maxTurns) {
        turnCount++;
        const turnSpanId = crypto.randomUUID();

        pushEvent(this.env, relayId, {
          type: "turn.start",
          conversationId,
          data: { turn: turnCount, traceId },
          seq: 0,
          timestamp: new Date().toISOString(),
        });

        const response = await this.traced(
          step,
          traces,
          `inference-${turnCount}`,
          {
            traceId,
            parentSpanId: rootSpanId,
            spanId: turnSpanId,
            kind: "inference",
            input: JSON.stringify(
              inferenceMessages.slice(-5).map((m) => ({
                role: m.role,
                content:
                  typeof m.content === "string"
                    ? m.content.slice(0, 500)
                    : "[tool_calls]",
              }))
            ),
            attributes: {
              model: agentDef.model,
              turn: turnCount,
              messageCount: inferenceMessages.length,
            },
            fn: async () =>
              callInference(this.env, agentDef, inferenceMessages),
            onSuccess: (res: InferenceResponse) => ({
              output: JSON.stringify({
                finish_reason: res.choices[0]?.finish_reason,
                content: res.choices[0]?.message.content?.slice(0, 500),
                tool_calls: res.choices[0]?.message.tool_calls?.map((tc) => ({
                  name: tc.function.name,
                })),
                usage: res.usage,
              }),
              attributes: {
                finish_reason: res.choices[0]?.finish_reason,
                prompt_tokens: res.usage?.prompt_tokens,
                completion_tokens: res.usage?.completion_tokens,
                total_tokens: res.usage?.total_tokens,
                has_tool_calls: !!res.choices[0]?.message.tool_calls?.length,
              },
            }),
          }
        );

        const choice = response.choices[0];
        if (!choice) throw new Error("No response from inference");

        const assistantContent = choice.message.content ?? "";
        const toolCalls = choice.message.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
          await this.traced(
            step,
            traces,
            `persist-response-${turnCount}`,
            {
              traceId,
              parentSpanId: rootSpanId,
              spanId: crypto.randomUUID(),
              kind: "persist",
              input: assistantContent.slice(0, 200),
              attributes: { operation: "addMessage", role: "assistant" },
              fn: async () => {
                await store.addMessage(conversationId, {
                  conversationId,
                  role: "assistant",
                  content: assistantContent,
                });
                return "ok";
              },
            }
          );

          pushEvent(this.env, relayId, {
            type: "turn.complete",
            conversationId,
            data: { content: assistantContent, turn: turnCount, traceId },
            seq: 0,
            timestamp: new Date().toISOString(),
          });

          return { conversationId, response: assistantContent };
        }

        const mappedToolCalls: ToolCall[] = toolCalls.map(
          (tc: {
            id: string;
            function: { name: string; arguments: string };
          }) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })
        );

        await this.traced(
          step,
          traces,
          `persist-assistant-${turnCount}`,
          {
            traceId,
            parentSpanId: rootSpanId,
            spanId: crypto.randomUUID(),
            kind: "persist",
            input: null,
            attributes: {
              operation: "addMessage",
              role: "assistant",
              toolCallCount: mappedToolCalls.length,
            },
            fn: async () => {
              await store.addMessage(conversationId, {
                conversationId,
                role: "assistant",
                content: assistantContent,
                toolCalls: mappedToolCalls,
              });
              return "ok";
            },
          }
        );

        inferenceMessages.push({
          role: "assistant",
          content: assistantContent,
          tool_calls: toolCalls,
        });

        const toolResults: ToolResult[] = [];

        for (const tc of mappedToolCalls) {
          pushEvent(this.env, relayId, {
            type: "tool.start",
            conversationId,
            data: { toolCallId: tc.id, name: tc.name, traceId },
            seq: 0,
            timestamp: new Date().toISOString(),
          });

          const result = await this.traced(
            step,
            traces,
            `tool-${turnCount}-${tc.name}-${tc.id}`,
            {
              traceId,
              parentSpanId: turnSpanId,
              spanId: crypto.randomUUID(),
              kind: "tool",
              input: tc.arguments,
              attributes: {
                toolName: tc.name,
                toolCallId: tc.id,
                turn: turnCount,
              },
              fn: async () => {
                const toolDef = agentDef.tools.find(
                  (t) => t.name === tc.name
                );
                if (!toolDef) {
                  return {
                    toolCallId: tc.id,
                    name: tc.name,
                    result: `Unknown tool: ${tc.name}`,
                    isError: true,
                  };
                }

                try {
                  const params = toolDef.parameters.parse(
                    JSON.parse(tc.arguments)
                  );
                  const output = await toolDef.execute(params, {
                    conversationId,
                    agentName,
                    env: this.env as unknown as Record<string, unknown>,
                  });
                  return {
                    toolCallId: tc.id,
                    name: tc.name,
                    result: JSON.stringify(output),
                  };
                } catch (err) {
                  const msg =
                    err instanceof Error ? err.message : String(err);
                  return {
                    toolCallId: tc.id,
                    name: tc.name,
                    result: msg,
                    isError: true,
                  };
                }
              },
            }
          );

          toolResults.push(result);

          pushEvent(this.env, relayId, {
            type: "tool.result",
            conversationId,
            data: {
              toolCallId: tc.id,
              name: tc.name,
              result: result.result,
              isError: result.isError,
              traceId,
            },
            seq: 0,
            timestamp: new Date().toISOString(),
          });

          inferenceMessages.push({
            role: "tool",
            content: result.result,
            tool_call_id: tc.id,
          });
        }

        await this.traced(
          step,
          traces,
          `persist-tool-results-${turnCount}`,
          {
            traceId,
            parentSpanId: rootSpanId,
            spanId: crypto.randomUUID(),
            kind: "persist",
            input: null,
            attributes: {
              operation: "addMessage",
              role: "tool",
              resultCount: toolResults.length,
            },
            fn: async () => {
              await store.addMessage(conversationId, {
                conversationId,
                role: "tool",
                content: "",
                toolResults,
              });
              return "ok";
            },
          }
        );
      }

      const finalMsg = "Max turns reached.";
      await step.do("persist-max-turns", async () => {
        await store.addMessage(conversationId, {
          conversationId,
          role: "assistant",
          content: finalMsg,
        });
      });

      return { conversationId, response: finalMsg };
    }

    private async traced<T extends Rpc.Serializable<T>>(
      step: WorkflowStep,
      traces: TraceStore | undefined,
      stepName: string,
      opts: {
        traceId: string;
        parentSpanId: string;
        spanId: string;
        kind: "inference" | "tool" | "persist" | "system";
        input: string | null;
        attributes: Record<string, unknown>;
        fn: () => Promise<T>;
        onSuccess?: (
          result: T
        ) => { output?: string; attributes?: Record<string, unknown> };
      }
    ): Promise<T> {
      if (!traces) {
        return step.do(stepName, async () => opts.fn());
      }

      return step.do(stepName, async () => {
        await traces.createSpan({
          spanId: opts.spanId,
          traceId: opts.traceId,
          parentSpanId: opts.parentSpanId,
          name: stepName,
          kind: opts.kind,
          status: "running",
          startedAt: new Date().toISOString(),
          attributes: opts.attributes,
          input: opts.input,
          output: null,
          error: null,
        });

        try {
          const result = await opts.fn();
          const extra = opts.onSuccess?.(result);
          const output =
            extra?.output ??
            (typeof result === "string"
              ? result
              : JSON.stringify(result)?.slice(0, 2000));

          if (extra?.attributes) {
            // Merge additional attributes discovered at runtime
            Object.assign(opts.attributes, extra.attributes);
          }

          await traces.endSpan(opts.spanId, "ok", output);
          return result;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const errorStack =
            err instanceof Error ? err.stack ?? errorMsg : errorMsg;
          await traces.endSpan(opts.spanId, "error", null, errorStack);
          throw err;
        }
      });
    }
  };
}

function buildMessages(
  system: string,
  history: Message[]
): InferenceMessage[] {
  const messages: InferenceMessage[] = [{ role: "system", content: system }];

  for (const msg of history) {
    if (msg.role === "tool" && msg.toolResults) {
      for (const tr of msg.toolResults) {
        messages.push({
          role: "tool",
          content: tr.result,
          tool_call_id: tr.toolCallId,
        });
      }
    } else if (msg.role === "assistant" && msg.toolCalls) {
      messages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  return messages;
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  if (
    schema &&
    typeof schema === "object" &&
    "_def" in (schema as Record<string, unknown>)
  ) {
    const def = (
      schema as {
        _def: {
          typeName: string;
          shape?: () => Record<string, unknown>;
        };
      }
    )._def;
    if (def.typeName === "ZodObject" && def.shape) {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(val);
        const valDef = (val as { _def?: { typeName?: string } })?._def;
        if (valDef?.typeName !== "ZodOptional") {
          required.push(key);
        }
      }
      return { type: "object", properties, required };
    }
    if (def.typeName === "ZodString") return { type: "string" };
    if (def.typeName === "ZodNumber") return { type: "number" };
    if (def.typeName === "ZodBoolean") return { type: "boolean" };
    if (def.typeName === "ZodOptional") {
      return zodToJsonSchema(
        (def as unknown as { innerType: unknown }).innerType
      );
    }
    if (def.typeName === "ZodArray") {
      return {
        type: "array",
        items: zodToJsonSchema((def as unknown as { type: unknown }).type),
      };
    }
  }
  return { type: "string" };
}

async function callInference(
  env: LoadstarBindings,
  agentDef: AgentDefinition,
  messages: InferenceMessage[]
): Promise<InferenceResponse> {
  const tools = agentDef.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters),
    },
  }));

  const body: Record<string, unknown> = {
    model: agentDef.model,
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools;
  }

  const gateway = agentDef.gateway ?? {
    accountId: env.AI_GATEWAY_ACCOUNT_ID as string | undefined,
    gatewayId: env.AI_GATEWAY_ID as string | undefined,
  };

  if (!gateway.accountId || !gateway.gatewayId) {
    throw new Error(
      "AI Gateway config required: set gateway on agent or AI_GATEWAY_ACCOUNT_ID / AI_GATEWAY_ID env vars"
    );
  }

  const url = `https://gateway.ai.cloudflare.com/v1/${gateway.accountId}/${gateway.gatewayId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Inference failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<InferenceResponse>;
}

function pushEvent(
  env: LoadstarBindings,
  relayId: string | undefined,
  event: AgentEvent
): void {
  if (!relayId) return;
  try {
    const id = env.RELAY.idFromString(relayId);
    const stub = env.RELAY.get(id);
    stub.fetch("http://relay/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Relay unavailable — events are best-effort
  }
}
