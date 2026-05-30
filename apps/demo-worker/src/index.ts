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

        console.log(`[search] querying: "${query}"`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; Loadstar/1.0; +https://github.com/cif/loadstar)",
            },
            signal: controller.signal,
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

          if (results.length > 0) {
            console.log(`[search] found ${results.length} results from HTML`);
            return { results };
          }

          console.warn(`[search] HTML scrape returned 0 results, trying API fallback`);
          const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
          const apiRes = await fetch(apiUrl, { signal: controller.signal });
          const data = await apiRes.json() as Record<string, unknown>;
          const fallbackResults: { title: string; snippet: string; url: string }[] = [];
          if (data.AbstractText) {
            fallbackResults.push({
              title: data.Heading as string || query,
              snippet: (data.AbstractText as string).slice(0, 300),
              url: data.AbstractURL as string || "",
            });
          }
          const topics = (data.RelatedTopics as { Text?: string; FirstURL?: string }[]) ?? [];
          for (const topic of topics.slice(0, 4)) {
            if (topic.Text) {
              fallbackResults.push({
                title: topic.Text.slice(0, 80),
                snippet: topic.Text,
                url: topic.FirstURL ?? "",
              });
            }
          }
          return { results: fallbackResults.length > 0 ? fallbackResults : [{ title: `No results for: ${query}`, snippet: "Try a different search query.", url: "" }] };
        } catch (e) {
          console.error(`[search] failed:`, e);
          return { results: [{ title: `Search failed for: ${query}`, snippet: "Search timed out or was blocked.", url: "" }] };
        } finally {
          clearTimeout(timeout);
        }
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
  async fetch(request: Request, env: Parameters<typeof app.fetch>[1] & { ASSETS?: { fetch: typeof fetch } }) {
    if (new URL(request.url).pathname === "/_migrate") {
      await app.migrate(env);
      return new Response("Migrated");
    }
    const response = await app.fetch(request, env);
    if (response) return response;
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
      return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    }
    return new Response("Not found", { status: 404 });
  },
};
