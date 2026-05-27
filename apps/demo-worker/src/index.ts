import { loadstar, agent, tool, RelayDO } from "loadstar";
import { z } from "zod";

const researcher = agent({
  name: "researcher",
  model: "@cf/meta/llama-3.2-3b-instruct",
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
          const tokens = params.expression.match(/(\d+\.?\d*|[+\-*/])/g);
          if (!tokens) return { error: "Invalid expression" };
          let result = parseFloat(tokens[0]);
          for (let i = 1; i < tokens.length; i += 2) {
            const op = tokens[i];
            const num = parseFloat(tokens[i + 1]);
            if (op === "+") result += num;
            else if (op === "-") result -= num;
            else if (op === "*") result *= num;
            else if (op === "/") result /= num;
          }
          return { result: String(result) };
        } catch (e) {
          return { error: String(e) };
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
