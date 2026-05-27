import type {
  AgentDefinition,
  ConversationStore,
  LoadstarBindings,
  TraceStore,
} from "./types.js";

type StoreFactory = (env: LoadstarBindings) => ConversationStore;
type TraceStoreFactory = (env: LoadstarBindings) => TraceStore;

export function createHandler(
  agents: Map<string, AgentDefinition>,
  storeFactory: StoreFactory,
  traceStoreFactory?: TraceStoreFactory
) {
  return async function handle(
    request: Request,
    env: LoadstarBindings
  ): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const store = storeFactory(env);
    const traces = traceStoreFactory?.(env);

    // POST /agents/:name/conversations — create conversation
    const createMatch = url.pathname.match(
      /^\/agents\/([^/]+)\/conversations$/
    );
    if (createMatch && method === "POST") {
      const agentName = createMatch[1];
      if (!agents.has(agentName)) {
        return json({ error: `Unknown agent: ${agentName}` }, 404);
      }
      const conversation = await store.createConversation(agentName);
      return json(conversation, 201);
    }

    // GET /conversations/:id — get conversation
    const getConvMatch = url.pathname.match(/^\/conversations\/([^/]+)$/);
    if (getConvMatch && method === "GET") {
      const conversation = await store.getConversation(getConvMatch[1]);
      if (!conversation) return json({ error: "Not found" }, 404);
      return json(conversation);
    }

    // GET /conversations/:id/messages — get messages
    const getMsgsMatch = url.pathname.match(
      /^\/conversations\/([^/]+)\/messages$/
    );
    if (getMsgsMatch && method === "GET") {
      const afterSeq = url.searchParams.get("after");
      const messages = await store.getMessages(
        getMsgsMatch[1],
        afterSeq ? parseInt(afterSeq, 10) : undefined
      );
      return json(messages);
    }

    // POST /conversations/:id/messages — send message (triggers workflow)
    const sendMsgMatch = url.pathname.match(
      /^\/conversations\/([^/]+)\/messages$/
    );
    if (sendMsgMatch && method === "POST") {
      const conversationId = sendMsgMatch[1];
      const conversation = await store.getConversation(conversationId);
      if (!conversation) return json({ error: "Not found" }, 404);

      const body = (await request.json()) as { message: string };
      if (!body.message) {
        return json({ error: "message is required" }, 400);
      }

      const relayId = env.RELAY.newUniqueId();

      const instance = await env.AGENT_WORKFLOW.create({
        params: {
          agentName: conversation.agentName,
          conversationId,
          message: body.message,
          relayId: relayId.toString(),
        },
      });

      return json({
        workflowId: instance.id,
        relayId: relayId.toString(),
        conversationId,
      });
    }

    // GET /conversations/:id/ws — WebSocket upgrade to relay
    const wsMatch = url.pathname.match(/^\/conversations\/([^/]+)\/ws$/);
    if (wsMatch) {
      const relayIdParam = url.searchParams.get("relayId");
      if (!relayIdParam) {
        return json({ error: "relayId query param required" }, 400);
      }

      const relayId = env.RELAY.idFromString(relayIdParam);
      const stub = env.RELAY.get(relayId);
      return stub.fetch(new Request("http://relay/ws", request));
    }

    // GET /agents — list registered agents
    if (url.pathname === "/agents" && method === "GET") {
      const agentList = Array.from(agents.values()).map((a) => ({
        name: a.name,
        model: a.model,
        tools: a.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      }));
      return json(agentList);
    }

    // --- Trace endpoints ---

    // GET /traces — list recent traces
    if (url.pathname === "/traces" && method === "GET") {
      if (!traces) return json({ error: "Tracing not configured" }, 501);
      const limit = url.searchParams.get("limit");
      const list = await traces.listTraces(
        limit ? parseInt(limit, 10) : undefined
      );
      return json(list);
    }

    // GET /traces/:id — get trace with all spans
    const traceMatch = url.pathname.match(/^\/traces\/([^/]+)$/);
    if (traceMatch && method === "GET") {
      if (!traces) return json({ error: "Tracing not configured" }, 501);
      const trace = await traces.getTrace(traceMatch[1]);
      if (!trace) return json({ error: "Trace not found" }, 404);
      return json(trace);
    }

    return json({ error: "Not found" }, 404);
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
