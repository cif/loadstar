import type {
  AgentDefinition,
  ConversationStore,
  LoadstarBindings,
} from "./types.js";
import { createAgentWorkflow } from "./workflow.js";
import { createHandler } from "./handler.js";
import { D1ConversationStore } from "./adapters/d1.js";

export { agent, tool } from "./agent.js";
export { RelayDO } from "./relay.js";
export { D1ConversationStore } from "./adapters/d1.js";
export type {
  AgentDefinition,
  AgentEvent,
  Conversation,
  ConversationStore,
  LoadstarBindings,
  Message,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolResult,
  WorkflowPayload,
} from "./types.js";

interface LoadstarConfig {
  agents: AgentDefinition[];
  store?: (env: LoadstarBindings) => ConversationStore;
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

  const AgentWorkflow = createAgentWorkflow(agentMap, storeFactory);

  return {
    AgentWorkflow,

    fetch: async (request: Request, env: LoadstarBindings) => {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }
      const handler = createHandler(agentMap, storeFactory);
      return handler(request, env);
    },

    async migrate(env: LoadstarBindings) {
      if (env.DB) {
        const store = new D1ConversationStore(env.DB);
        await store.migrate();
      }
    },
  };
}
