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

export interface LoadstarClientOptions {
  baseUrl: string;
}
