import type {
  AgentDefinition,
  ConversationStore,
  Conversation,
  Message,
  Trace,
  TraceStore,
  TraceWithSpans,
  Span,
  SpanEvent,
  SpanStatus,
} from "loadstar";
import { MockInferenceServer } from "./mock-inference.js";

export interface CrashTestResult {
  crashPoint: number;
  totalSteps: number;
  completed: boolean;
  finalMessages: Message[];
  trace: TraceWithSpans | null;
  replays: number;
  error?: string;
}

export interface ChaosTestResult {
  runs: CrashTestResult[];
  allCompleted: boolean;
  deterministic: boolean;
  summary: string;
}

class InMemoryConversationStore implements ConversationStore {
  private conversations = new Map<string, Conversation>();
  private messages = new Map<string, Message[]>();
  private seqCounters = new Map<string, number>();

  async createConversation(agentName: string): Promise<Conversation> {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      agentName,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.conversations.set(conv.id, conv);
    this.messages.set(conv.id, []);
    this.seqCounters.set(conv.id, 0);
    return conv;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async listConversations(agentName?: string): Promise<Conversation[]> {
    const all = Array.from(this.conversations.values());
    return agentName ? all.filter((c) => c.agentName === agentName) : all;
  }

  async addMessage(
    conversationId: string,
    message: Omit<Message, "id" | "seq" | "createdAt">
  ): Promise<Message> {
    const seq = (this.seqCounters.get(conversationId) ?? 0) + 1;
    this.seqCounters.set(conversationId, seq);
    const msg: Message = {
      ...message,
      id: crypto.randomUUID(),
      seq,
      createdAt: new Date().toISOString(),
    };
    const msgs = this.messages.get(conversationId) ?? [];
    msgs.push(msg);
    this.messages.set(conversationId, msgs);
    return msg;
  }

  async getMessages(conversationId: string, afterSeq?: number): Promise<Message[]> {
    const msgs = this.messages.get(conversationId) ?? [];
    return afterSeq ? msgs.filter((m) => m.seq > afterSeq) : msgs;
  }

  getAllMessages(conversationId: string): Message[] {
    return this.messages.get(conversationId) ?? [];
  }
}

class InMemoryTraceStore implements TraceStore {
  private traces = new Map<string, Trace>();
  private spans = new Map<string, Span[]>();
  private spanMap = new Map<string, Span>();

  async createTrace(
    trace: Omit<Trace, "endedAt" | "durationMs" | "status"> & { status?: SpanStatus }
  ): Promise<Trace> {
    const t: Trace = { ...trace, status: trace.status ?? "running", endedAt: null, durationMs: null };
    this.traces.set(t.traceId, t);
    this.spans.set(t.traceId, []);
    return t;
  }

  async endTrace(traceId: string, status: SpanStatus): Promise<void> {
    const t = this.traces.get(traceId);
    if (t) {
      t.status = status;
      t.endedAt = new Date().toISOString();
      t.durationMs = new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime();
    }
  }

  async getTrace(traceId: string): Promise<TraceWithSpans | null> {
    const t = this.traces.get(traceId);
    if (!t) return null;
    return { ...t, spans: this.spans.get(traceId) ?? [] };
  }

  async listTraces(): Promise<Trace[]> {
    return Array.from(this.traces.values());
  }

  async createSpan(
    span: Omit<Span, "endedAt" | "durationMs" | "events"> & { events?: SpanEvent[] }
  ): Promise<Span> {
    const s: Span = { ...span, endedAt: null, durationMs: null, events: span.events ?? [] };
    this.spanMap.set(s.spanId, s);
    const traceSpans = this.spans.get(s.traceId) ?? [];
    traceSpans.push(s);
    this.spans.set(s.traceId, traceSpans);
    return s;
  }

  async endSpan(
    spanId: string,
    status: SpanStatus,
    output?: string | null,
    error?: string | null
  ): Promise<void> {
    const s = this.spanMap.get(spanId);
    if (s) {
      s.status = status;
      s.endedAt = new Date().toISOString();
      s.durationMs = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
      if (output !== undefined) s.output = output ?? null;
      if (error !== undefined) s.error = error ?? null;
    }
  }

  async addSpanEvent(spanId: string, event: SpanEvent): Promise<void> {
    const s = this.spanMap.get(spanId);
    if (s) s.events.push(event);
  }

  getLatestTrace(): TraceWithSpans | null {
    const traces = Array.from(this.traces.values());
    if (traces.length === 0) return null;
    const latest = traces[traces.length - 1];
    return { ...latest, spans: this.spans.get(latest.traceId) ?? [] };
  }
}

export class WorkflowSimulator {
  private steps: { name: string; fn: () => Promise<unknown> }[] = [];
  private completedSteps = new Map<string, unknown>();
  private crashAfter: number | null = null;
  private currentStep = 0;

  constructor(
    private agent: AgentDefinition,
    private mockInference: MockInferenceServer
  ) {}

  crashAfterStep(n: number): this {
    this.crashAfter = n;
    return this;
  }

  async run(
    message: string,
    options: { maxReplays?: number } = {}
  ): Promise<CrashTestResult> {
    const maxReplays = options.maxReplays ?? 10;
    const store = new InMemoryConversationStore();
    const traceStore = new InMemoryTraceStore();
    let replays = 0;
    let completed = false;
    let error: string | undefined;

    const conv = await store.createConversation(this.agent.name);

    while (!completed && replays <= maxReplays) {
      this.currentStep = 0;
      this.mockInference.reset();

      try {
        await this.executeWorkflow(conv.id, message, store, traceStore);
        completed = true;
      } catch (e) {
        if (e instanceof CrashSimulationError) {
          replays++;
          this.crashAfter = null;
        } else {
          error = e instanceof Error ? e.message : String(e);
          break;
        }
      }
    }

    const trace = traceStore.getLatestTrace();
    const messages = store.getAllMessages(conv.id);

    return {
      crashPoint: this.crashAfter ?? -1,
      totalSteps: this.currentStep,
      completed,
      finalMessages: messages,
      trace,
      replays,
      error,
    };
  }

  private async executeWorkflow(
    conversationId: string,
    message: string,
    store: InMemoryConversationStore,
    traceStore: InMemoryTraceStore
  ): Promise<void> {
    const stepDo = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      this.currentStep++;

      if (this.completedSteps.has(name)) {
        return this.completedSteps.get(name) as T;
      }

      if (this.crashAfter !== null && this.currentStep > this.crashAfter) {
        throw new CrashSimulationError(
          `Simulated crash after step ${this.crashAfter} (at step "${name}")`
        );
      }

      const result = await fn();
      this.completedSteps.set(name, result);
      return result;
    };

    const traceId = crypto.randomUUID();
    await stepDo("trace-init", async () => {
      await traceStore.createTrace({
        traceId,
        conversationId,
        agentName: this.agent.name,
        startedAt: new Date().toISOString(),
        input: message,
      });
    });

    await stepDo("persist-user-message", async () => {
      await store.addMessage(conversationId, {
        conversationId,
        role: "user",
        content: message,
      });
    });

    const history = await stepDo("load-history", async () => {
      return store.getMessages(conversationId);
    });

    const system =
      typeof this.agent.system === "function"
        ? await stepDo("resolve-system-prompt", async () =>
            (this.agent.system as Function)({ conversationId, env: {} })
          )
        : this.agent.system;

    let turnCount = 0;
    const maxTurns = this.agent.maxTurns ?? 10;

    const buildMessages = (history: Message[]) => {
      const msgs: Record<string, unknown>[] = [
        { role: "system", content: system },
      ];
      for (const m of history as Message[]) {
        msgs.push({ role: m.role, content: m.content });
      }
      return msgs;
    };

    let currentHistory = history as Message[];

    while (turnCount < maxTurns) {
      turnCount++;

      const turn = this.mockInference.getNextTurn();
      const response = this.mockInference.buildResponse(turn);

      await stepDo(`inference-${turnCount}`, async () => {
        await traceStore.createSpan({
          spanId: crypto.randomUUID(),
          traceId,
          parentSpanId: null,
          name: `inference-${turnCount}`,
          kind: "inference",
          status: "ok",
          startedAt: new Date().toISOString(),
          attributes: { model: this.agent.model, turn: turnCount },
          input: JSON.stringify(buildMessages(currentHistory).slice(-3)),
          output: JSON.stringify(response),
          error: null,
        });
        return response;
      });

      const choice = (response as { choices: { message: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] }).choices[0];
      const toolCalls = choice.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        await stepDo(`persist-response-${turnCount}`, async () => {
          await store.addMessage(conversationId, {
            conversationId,
            role: "assistant",
            content: choice.message.content ?? "",
          });
        });

        await stepDo("trace-end", async () => {
          await traceStore.endTrace(traceId, "ok");
        });
        return;
      }

      await stepDo(`persist-assistant-${turnCount}`, async () => {
        await store.addMessage(conversationId, {
          conversationId,
          role: "assistant",
          content: choice.message.content ?? "",
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          })),
        });
      });

      for (const tc of toolCalls) {
        const toolDef = this.agent.tools.find(
          (t) => t.name === tc.function.name
        );

        const result = await stepDo(
          `tool-${turnCount}-${tc.function.name}-${tc.id}`,
          async () => {
            if (!toolDef) return { error: `Unknown tool: ${tc.function.name}` };
            try {
              const params = toolDef.parameters.parse(
                JSON.parse(tc.function.arguments)
              );
              return await toolDef.execute(params, {
                conversationId,
                agentName: this.agent.name,
                env: {},
              });
            } catch (e) {
              return { error: e instanceof Error ? e.message : String(e) };
            }
          }
        );

        await stepDo(`persist-tool-${turnCount}-${tc.id}`, async () => {
          await store.addMessage(conversationId, {
            conversationId,
            role: "tool",
            content: "",
            toolResults: [
              {
                toolCallId: tc.id,
                name: tc.function.name,
                result: JSON.stringify(result),
              },
            ],
          });
        });
      }

      currentHistory = await store.getMessages(conversationId);
    }
  }
}

class CrashSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrashSimulationError";
  }
}

export function simulateAgent(
  agent: AgentDefinition,
  mockInference: MockInferenceServer
): WorkflowSimulator {
  return new WorkflowSimulator(agent, mockInference);
}

export async function chaosTest(
  agent: AgentDefinition,
  mockInference: MockInferenceServer,
  message: string,
  options: { maxSteps?: number } = {}
): Promise<ChaosTestResult> {
  const maxSteps = options.maxSteps ?? 20;
  const runs: CrashTestResult[] = [];

  // First: run without crashing to find total step count
  const baseline = await simulateAgent(agent, mockInference).run(message);
  runs.push(baseline);

  if (!baseline.completed) {
    return {
      runs,
      allCompleted: false,
      deterministic: false,
      summary: `Baseline run failed: ${baseline.error}`,
    };
  }

  const totalSteps = baseline.totalSteps;

  // Now crash at every possible step and verify recovery
  for (let crashAt = 1; crashAt <= Math.min(totalSteps, maxSteps); crashAt++) {
    mockInference.reset();
    const result = await simulateAgent(agent, mockInference)
      .crashAfterStep(crashAt)
      .run(message);
    runs.push(result);
  }

  const allCompleted = runs.every((r) => r.completed);
  const baselineContent = baseline.finalMessages
    .filter((m) => m.role === "assistant" && m.content)
    .map((m) => m.content)
    .join("|");

  const deterministic = runs.every((r) => {
    const content = r.finalMessages
      .filter((m) => m.role === "assistant" && m.content)
      .map((m) => m.content)
      .join("|");
    return content === baselineContent;
  });

  const failedRuns = runs.filter((r) => !r.completed);
  const summary = allCompleted
    ? `All ${runs.length} runs completed (baseline + ${totalSteps} crash points). ${deterministic ? "Output is deterministic." : "WARNING: Output varies across runs."}`
    : `${failedRuns.length}/${runs.length} runs failed. Crash points that failed: ${failedRuns.map((r) => r.crashPoint).join(", ")}`;

  return { runs, allCompleted, deterministic, summary };
}
