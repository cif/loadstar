import { loadstar, agent, tool, RelayDO } from "loadstar";
import { z } from "zod";

const researcher = agent({
  name: "researcher",
  model: "@cf/meta/llama-3.2-3b-instruct",
  system: `You are a helpful research assistant. Be concise and cite your sources when possible.

When using tools, you MUST use the exact parameter names specified. For the search tool, the parameter is "query". For the calculate tool, the parameter is "expression". Example: {"query": "your search terms here"}`,
  tools: [
    tool({
      name: "search",
      description:
        "Search the web for information on a given topic. Returns relevant results.",
      parameters: z.object({
        query: z.string().optional().describe("The search query"),
      }).passthrough(),
      execute: async (params: Record<string, unknown>) => {
        let query = params.query as string | undefined;
        if (!query) {
          const vals = Object.values(params).filter((v) => typeof v === "string");
          query = vals[0] as string;
        }
        if (!query) return { results: [{ title: "No query provided", snippet: "Pass a query parameter", url: "" }] };

        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "loadstar-agent/1.0" },
        });
        const html = await res.text();

        const results: { title: string; snippet: string; url: string }[] = [];
        const linkRegex =
          /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetRegex =
          /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        const links = [...html.matchAll(linkRegex)];
        const snippets = [...html.matchAll(snippetRegex)];

        for (let i = 0; i < Math.min(links.length, 5); i++) {
          const rawUrl = links[i][1];
          let decodedUrl = rawUrl;
          const uddg = rawUrl.match(/uddg=([^&]+)/);
          if (uddg) decodedUrl = decodeURIComponent(uddg[1]);

          results.push({
            title: links[i][2].replace(/<[^>]*>/g, "").trim(),
            snippet: (snippets[i]?.[1] ?? "").replace(/<[^>]*>/g, "").trim(),
            url: decodedUrl,
          });
        }

        return { results: results.length > 0 ? results : [{ title: "No results", snippet: "", url: "" }] };
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
