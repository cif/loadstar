export interface Conversation {
  id: string;
  agentName: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
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

export interface AgentInfo {
  name: string;
  model: string;
  tools: { name: string; description: string }[];
}

export interface SendMessageResult {
  workflowId: string;
  relayId: string;
  conversationId: string;
}

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

export interface LoadstarClientOptions {
  baseUrl: string;
}
