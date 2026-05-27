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
