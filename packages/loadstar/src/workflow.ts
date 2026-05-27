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
}

type WorkflowClass = typeof WorkflowEntrypoint<LoadstarBindings, WorkflowPayload>;

export function createAgentWorkflow(
  agents: Map<string, AgentDefinition>,
  storeFactory: (env: LoadstarBindings) => ConversationStore
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

      await step.do("persist-user-message", async () => {
        await store.addMessage(conversationId, {
          conversationId,
          role: "user",
          content: message,
        });
      });

      const history = await step.do("load-history", async () => {
        return store.getMessages(conversationId);
      });

      const system =
        typeof agentDef.system === "function"
          ? await step.do<string>("resolve-system-prompt", async () => {
              return (agentDef.system as Function)({
                conversationId,
                env: this.env,
              });
            })
          : agentDef.system;

      const inferenceMessages = buildMessages(system as string, history);
      let turnCount = 0;
      const maxTurns = agentDef.maxTurns ?? 10;

      while (turnCount < maxTurns) {
        turnCount++;

        pushEvent(this.env, relayId, {
          type: "turn.start",
          conversationId,
          data: { turn: turnCount },
          seq: 0,
          timestamp: new Date().toISOString(),
        });

        const response = await step.do(
          `inference-${turnCount}`,
          async () => {
            return callInference(this.env, agentDef, inferenceMessages);
          }
        );

        const choice = response.choices[0];
        if (!choice) throw new Error("No response from inference");

        const assistantContent = choice.message.content ?? "";
        const toolCalls = choice.message.tool_calls;

        if (!toolCalls || toolCalls.length === 0) {
          await step.do(`persist-response-${turnCount}`, async () => {
            await store.addMessage(conversationId, {
              conversationId,
              role: "assistant",
              content: assistantContent,
            });
          });

          pushEvent(this.env, relayId, {
            type: "turn.complete",
            conversationId,
            data: { content: assistantContent, turn: turnCount },
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

        await step.do(`persist-assistant-${turnCount}`, async () => {
          await store.addMessage(conversationId, {
            conversationId,
            role: "assistant",
            content: assistantContent,
            toolCalls: mappedToolCalls,
          });
        });

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
            data: { toolCallId: tc.id, name: tc.name },
            seq: 0,
            timestamp: new Date().toISOString(),
          });

          const result = await step.do(
            `tool-${turnCount}-${tc.name}-${tc.id}`,
            async () => {
              const toolDef = agentDef.tools.find((t) => t.name === tc.name);
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
                const msg = err instanceof Error ? err.message : String(err);
                return {
                  toolCallId: tc.id,
                  name: tc.name,
                  result: msg,
                  isError: true,
                };
              }
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

        await step.do(`persist-tool-results-${turnCount}`, async () => {
          await store.addMessage(conversationId, {
            conversationId,
            role: "tool",
            content: "",
            toolResults,
          });
        });
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
  };
}

function buildMessages(system: string, history: Message[]): InferenceMessage[] {
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
