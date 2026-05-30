import type {
  AgentDefinition,
  ConversationStore,
  LoadstarBindings,
  TraceStore,
} from "./types.js";
import { createAgentWorkflow } from "./workflow.js";
import { createHandler } from "./handler.js";
import { D1ConversationStore } from "./adapters/d1.js";
import { D1TraceStore } from "./adapters/d1-traces.js";
import { D1LogStore } from "./adapters/d1-logs.js";

export { agent, tool } from "./agent.js";
export { RelayDO } from "./relay.js";
export { D1ConversationStore } from "./adapters/d1.js";
export { D1TraceStore } from "./adapters/d1-traces.js";
export { D1LogStore, type WorkerLog } from "./adapters/d1-logs.js";
export { WorkflowLogger } from "./logger.js";
export type { LogEntry, LogLevel } from "./logger.js";
export type {
  AgentDefinition,
  AgentEvent,
  Conversation,
  ConversationStore,
  LoadstarBindings,
  Message,
  Span,
  SpanEvent,
  SpanKind,
  SpanStatus,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolResult,
  Trace,
  TraceStore,
  TraceWithSpans,
  WorkflowPayload,
} from "./types.js";

interface LoadstarConfig {
  agents: AgentDefinition[];
  store?: (env: LoadstarBindings) => ConversationStore;
  traceStore?: (env: LoadstarBindings) => TraceStore;
}

export function loadstar(config: LoadstarConfig) {
  const agentMap = new Map<string, AgentDefinition>();
  for (const a of config.agents) {
    agentMap.set(a.name, a);
  }

  const storeFactory =
    config.store ??
    ((env: LoadstarBindings) => {
      if (!env.DB) {
        throw new Error(
          "No store configured and no DB binding found. Either pass a store factory or bind a D1 database as DB."
        );
      }
      return new D1ConversationStore(env.DB);
    });

  const traceStoreFactory =
    config.traceStore ??
    ((env: LoadstarBindings) => {
      if (!env.DB) return undefined as unknown as TraceStore;
      return new D1TraceStore(env.DB);
    });

  const AgentWorkflow = createAgentWorkflow(
    agentMap,
    storeFactory,
    traceStoreFactory
  );

  return {
    AgentWorkflow,

    fetch: async (request: Request, env: LoadstarBindings): Promise<Response | null> => {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }
      const handler = createHandler(agentMap, storeFactory, traceStoreFactory);
      return handler(request, env);
    },

    async migrate(env: LoadstarBindings) {
      if (env.DB) {
        const store = new D1ConversationStore(env.DB);
        await store.migrate();
        const traceStore = new D1TraceStore(env.DB);
        await traceStore.migrate();
        const logStore = new D1LogStore(env.DB);
        await logStore.migrate();
      }
    },
  };
}
