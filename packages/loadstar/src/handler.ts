import type {
  AgentDefinition,
  ConversationStore,
  LoadstarBindings,
  TraceStore,
} from "./types.js";
import { D1LogStore } from "./adapters/d1-logs.js";

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
  ): Promise<Response | null> {
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

    // GET /conversations — list all conversations
    if (url.pathname === "/conversations" && method === "GET") {
      const agentName = url.searchParams.get("agent") ?? undefined;
      const conversations = await store.listConversations(agentName);
      return json(conversations);
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

    // GET /metrics — aggregated performance metrics
    if (url.pathname === "/metrics" && method === "GET") {
      if (!traces) return json({ error: "Tracing not configured" }, 501);
      if (!env.DB) return json({ error: "No DB" }, 501);

      const db = env.DB;
      const [traceStats, inferenceStats, toolStats, recentInference, recentTools] =
        await Promise.all([
          db
            .prepare(
              `SELECT
                count(*) as total,
                sum(case when status = 'ok' then 1 else 0 end) as ok,
                sum(case when status = 'error' then 1 else 0 end) as errors,
                avg(duration_ms) as avg_duration_ms,
                min(duration_ms) as min_duration_ms,
                max(duration_ms) as max_duration_ms
              FROM traces WHERE status != 'running'`
            )
            .first(),
          db
            .prepare(
              `SELECT
                count(*) as total,
                avg(duration_ms) as avg_ms,
                min(duration_ms) as min_ms,
                max(duration_ms) as max_ms,
                sum(case when status = 'error' then 1 else 0 end) as errors
              FROM spans WHERE kind = 'inference' AND status != 'running'`
            )
            .first(),
          db
            .prepare(
              `SELECT
                json_extract(attributes, '$.toolName') as name,
                count(*) as calls,
                avg(duration_ms) as avg_ms,
                sum(case when status = 'error' then 1 else 0 end) as errors
              FROM spans WHERE kind = 'tool' AND status != 'running'
              GROUP BY json_extract(attributes, '$.toolName')`
            )
            .all(),
          db
            .prepare(
              `SELECT duration_ms, started_at
              FROM spans WHERE kind = 'inference' AND status != 'running'
              ORDER BY started_at DESC LIMIT 50`
            )
            .all(),
          db
            .prepare(
              `SELECT json_extract(attributes, '$.toolName') as name, duration_ms, status, started_at
              FROM spans WHERE kind = 'tool' AND status != 'running'
              ORDER BY started_at DESC LIMIT 50`
            )
            .all(),
        ]);

      return json({
        traces: traceStats,
        inference: inferenceStats,
        tools: toolStats?.results ?? [],
        recentInference: recentInference?.results ?? [],
        recentTools: recentTools?.results ?? [],
      });
    }

    // GET /logs — query worker logs
    if (url.pathname === "/logs" && method === "GET") {
      if (!env.DB) return json({ error: "No DB" }, 501);
      const logStore = new D1LogStore(env.DB);
      const logs = await logStore.query({
        traceId: url.searchParams.get("traceId") ?? undefined,
        level: (url.searchParams.get("level") as "log" | "warn" | "error") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
        limit: url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!, 10)
          : undefined,
        since: url.searchParams.get("since") ?? undefined,
      });
      return json(logs);
    }

    return null;
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
