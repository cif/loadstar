import type {
  AgentEvent,
  AgentInfo,
  Conversation,
  LoadstarClientOptions,
  Message,
  SendMessageResult,
  Trace,
  TraceWithSpans,
} from "./types.js";

export class LoadstarClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private eventListeners: Map<string, Set<(event: AgentEvent) => void>> =
    new Map();

  constructor(options: LoadstarClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  async listAgents(): Promise<AgentInfo[]> {
    const res = await fetch(`${this.baseUrl}/agents`);
    return res.json();
  }

  async createConversation(agentName: string): Promise<Conversation> {
    const res = await fetch(
      `${this.baseUrl}/agents/${agentName}/conversations`,
      { method: "POST" }
    );
    if (!res.ok) throw new Error(`Failed to create conversation: ${res.status}`);
    return res.json();
  }

  async getConversation(id: string): Promise<Conversation> {
    const res = await fetch(`${this.baseUrl}/conversations/${id}`);
    if (!res.ok) throw new Error(`Conversation not found: ${id}`);
    return res.json();
  }

  async getMessages(conversationId: string, afterSeq?: number): Promise<Message[]> {
    const params = afterSeq ? `?after=${afterSeq}` : "";
    const res = await fetch(
      `${this.baseUrl}/conversations/${conversationId}/messages${params}`
    );
    return res.json();
  }

  async sendMessage(
    conversationId: string,
    message: string
  ): Promise<SendMessageResult> {
    const res = await fetch(
      `${this.baseUrl}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      }
    );
    if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
    return res.json();
  }

  connectRelay(conversationId: string, relayId: string): void {
    this.disconnectRelay();

    const wsUrl = this.baseUrl
      .replace(/^http/, "ws");
    this.ws = new WebSocket(
      `${wsUrl}/conversations/${conversationId}/ws?relayId=${relayId}`
    );

    this.ws.onmessage = (e) => {
      try {
        const event: AgentEvent = JSON.parse(e.data);
        this.emit(event.type, event);
        this.emit("*", event);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.emit("*", {
        type: "error",
        conversationId,
        data: { message: "WebSocket closed" },
        seq: 0,
        timestamp: new Date().toISOString(),
      });
    };
  }

  disconnectRelay(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async listTraces(limit?: number): Promise<Trace[]> {
    const params = limit ? `?limit=${limit}` : "";
    const res = await fetch(`${this.baseUrl}/traces${params}`);
    return res.json();
  }

  async getTrace(traceId: string): Promise<TraceWithSpans> {
    const res = await fetch(`${this.baseUrl}/traces/${traceId}`);
    if (!res.ok) throw new Error(`Trace not found: ${traceId}`);
    return res.json();
  }

  on(event: AgentEvent["type"] | "*", listener: (event: AgentEvent) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
    return () => {
      this.eventListeners.get(event)?.delete(listener);
    };
  }

  private emit(event: string, data: AgentEvent): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(data);
      }
    }
  }
}
