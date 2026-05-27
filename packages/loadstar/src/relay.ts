import { DurableObject } from "cloudflare:workers";
import type { AgentEvent, LoadstarBindings } from "./types.js";

export class RelayDO extends DurableObject<LoadstarBindings> {
  private sessions: Set<WebSocket> = new Set();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/event" && request.method === "POST") {
      return this.handleEvent(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocket(_request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.sessions.add(server);

    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });

    server.addEventListener("error", () => {
      this.sessions.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleEvent(request: Request): Promise<Response> {
    const event: AgentEvent = await request.json();
    const payload = JSON.stringify(event);

    const dead: WebSocket[] = [];
    for (const ws of this.sessions) {
      try {
        ws.send(payload);
      } catch {
        dead.push(ws);
      }
    }
    for (const ws of dead) {
      this.sessions.delete(ws);
    }

    return new Response("ok");
  }
}
