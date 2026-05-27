import type { z } from "zod";

export interface ToolDefinition<
  TParams extends z.ZodType = z.ZodType,
  TResult = unknown,
> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (
    params: z.infer<TParams>,
    ctx: ToolContext
  ) => TResult | Promise<TResult>;
}

export interface ToolContext {
  conversationId: string;
  agentName: string;
  env: Record<string, unknown>;
}

export interface AgentDefinition {
  name: string;
  model: string;
  system: string | ((ctx: AgentContext) => string | Promise<string>);
  tools: ToolDefinition[];
  gateway?: GatewayConfig;
  maxTurns?: number;
}

export interface AgentContext {
  conversationId: string;
  env: Record<string, unknown>;
}

export interface GatewayConfig {
  accountId: string;
  gatewayId: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  seq: number;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: string;
  isError?: boolean;
}

export interface Conversation {
  id: string;
  agentName: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export type EventType =
  | "turn.start"
  | "turn.chunk"
  | "turn.complete"
  | "tool.start"
  | "tool.result"
  | "error";

export interface AgentEvent {
  type: EventType;
  conversationId: string;
  data: Record<string, unknown>;
  seq: number;
  timestamp: string;
}

export interface ConversationStore {
  createConversation(agentName: string): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(agentName?: string): Promise<Conversation[]>;

  addMessage(conversationId: string, message: Omit<Message, "id" | "seq" | "createdAt">): Promise<Message>;
  getMessages(conversationId: string, afterSeq?: number): Promise<Message[]>;
}

export interface LoadstarBindings {
  AGENT_WORKFLOW: Workflow;
  RELAY: DurableObjectNamespace;
  DB?: D1Database;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  [key: string]: unknown;
}

export interface WorkflowPayload {
  agentName: string;
  conversationId: string;
  message: string;
  relayId?: string;
}

// --- Tracing (OTel-compatible) ---

export type SpanKind = "workflow" | "inference" | "tool" | "persist" | "system";
export type SpanStatus = "ok" | "error" | "running";

export interface Trace {
  traceId: string;
  conversationId: string;
  agentName: string;
  status: SpanStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  input: string;
}

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  input: string | null;
  output: string | null;
  error: string | null;
}

export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

export interface TraceWithSpans extends Trace {
  spans: Span[];
}

export interface TraceStore {
  createTrace(trace: Omit<Trace, "endedAt" | "durationMs" | "status"> & { status?: SpanStatus }): Promise<Trace>;
  endTrace(traceId: string, status: SpanStatus, error?: string): Promise<void>;
  getTrace(traceId: string): Promise<TraceWithSpans | null>;
  listTraces(limit?: number): Promise<Trace[]>;

  createSpan(span: Omit<Span, "endedAt" | "durationMs" | "events"> & { events?: SpanEvent[] }): Promise<Span>;
  endSpan(spanId: string, status: SpanStatus, output?: string | null, error?: string | null): Promise<void>;
  addSpanEvent(spanId: string, event: SpanEvent): Promise<void>;
}
