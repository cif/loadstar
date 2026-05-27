import { loadstar, agent, tool, RelayDO } from "loadstar";
import { z } from "zod";

const researcher = agent({
  name: "researcher",
  model: "@cf/meta/llama-3.1-70b-instruct",
  system: `You are a helpful research assistant. You can search for information and provide well-structured answers. Be concise and cite your sources when possible.`,
  tools: [
    tool({
      name: "search",
      description:
        "Search the web for information on a given topic. Returns relevant results.",
      parameters: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async (params) => {
        return {
          results: [
            {
              title: `Result for: ${params.query}`,
              snippet:
                "This is a placeholder. Connect a real search API here.",
              url: "https://example.com",
            },
          ],
        };
      },
    }),
    tool({
      name: "calculate",
      description: "Perform a mathematical calculation",
      parameters: z.object({
        expression: z.string().describe("The math expression to evaluate"),
      }),
      execute: async (params) => {
        try {
          const result = new Function(`return (${params.expression})`)();
          return { result: String(result) };
        } catch {
          return { error: "Invalid expression" };
        }
      },
    }),
  ],
});

const app = loadstar({ agents: [researcher] });

export const AgentWorkflow = app.AgentWorkflow;
export { RelayDO };
export default {
  async fetch(request: Request, env: Parameters<typeof app.fetch>[1]) {
    if (new URL(request.url).pathname === "/_migrate") {
      await app.migrate(env);
      return new Response("Migrated");
    }
    return app.fetch(request, env);
  },
};
