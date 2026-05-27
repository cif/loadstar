# loadstar

Durable AI agents on Cloudflare. Agents that survive deploys.

Cloudflare's [Agents SDK](https://developers.cloudflare.com/agents/) builds on Durable Objects, which get evicted during deployments — killing in-flight LLM calls and tool executions mid-turn. Loadstar moves the agent runtime to [Cloudflare Workflows](https://developers.cloudflare.com/workflows/) (durable execution with step-based checkpointing) so your agents keep running through deploys, crashes, and restarts.

- **Every step is checkpointed.** Inference calls, tool executions, and state writes are individual workflow steps. If the runtime restarts, it replays from the last completed step.
- **Full observability built in.** OTel-compatible traces stored in D1 with a waterfall viewer UI — see every inference call, tool execution, and error without leaving the app.
- **Bring your own storage.** `ConversationStore` and `TraceStore` are interfaces. Ship with D1, swap to Postgres/Turso/whatever.
- **Minimal DO surface.** A thin relay DO handles WebSocket streaming only — no state, no logic. If it drops during a deploy, the client reconnects and catches up from the API.

## Quick start (localhost)

You'll need a Cloudflare account with [AI Gateway](https://developers.cloudflare.com/ai-gateway/) set up.

### 1. Clone and install

```bash
git clone https://github.com/cif/loadstar.git
cd loadstar
pnpm install
```

### 2. Create a D1 database

```bash
cd apps/demo-worker
npx wrangler d1 create loadstar-db
```

Copy the `database_id` from the output into `apps/demo-worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "loadstar-db"
database_id = "paste-your-id-here"
```

### 3. Configure AI Gateway

Copy the example env file and fill in your Cloudflare account ID and gateway ID:

```bash
cp .dev.vars.example .dev.vars
```

```
AI_GATEWAY_ACCOUNT_ID=your-cloudflare-account-id
AI_GATEWAY_ID=your-gateway-id
```

You can find these in the Cloudflare dashboard under AI > AI Gateway.

### 4. Start the worker

```bash
npx wrangler dev
```

Then run the migration (one time):

```bash
curl http://localhost:8787/_migrate
```

### 5. Start the demo UI

In a second terminal:

```bash
cd apps/demo-client
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Send a message — you'll see the chat on the left and the trace waterfall on the right, showing every step the agent takes.

## Using loadstar in your own project

```bash
npm install loadstar zod
```

### Define an agent

```typescript
import { loadstar, agent, tool, RelayDO } from "loadstar";
import { z } from "zod";

const myAgent = agent({
  name: "assistant",
  model: "@cf/meta/llama-3.1-70b-instruct",
  system: "You are a helpful assistant.",
  tools: [
    tool({
      name: "lookup",
      description: "Look up a value by key",
      parameters: z.object({ key: z.string() }),
      execute: async (params, ctx) => {
        // your tool logic here — this runs as a durable step
        return { value: `result for ${params.key}` };
      },
    }),
  ],
});

const app = loadstar({ agents: [myAgent] });

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
```

### Configure wrangler.toml

```toml
name = "my-agent"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[workflows]]
name = "agent-workflow"
class_name = "AgentWorkflow"
binding = "AGENT_WORKFLOW"

[[durable_objects.bindings]]
name = "RELAY"
class_name = "RelayDO"

[[migrations]]
tag = "v1"
new_classes = ["RelayDO"]

[[d1_databases]]
binding = "DB"
database_name = "my-agent-db"
database_id = "your-database-id"
```

### Deploy

```bash
wrangler d1 create my-agent-db
# paste the database_id into wrangler.toml
wrangler deploy
curl https://my-agent.your-subdomain.workers.dev/_migrate
```

## API

### REST endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List registered agents |
| `POST` | `/agents/:name/conversations` | Create a conversation |
| `GET` | `/conversations/:id` | Get conversation |
| `GET` | `/conversations/:id/messages` | Get messages (optional `?after=seq`) |
| `POST` | `/conversations/:id/messages` | Send message `{ "message": "..." }` |
| `GET` | `/conversations/:id/ws?relayId=...` | WebSocket upgrade for live events |
| `GET` | `/traces` | List recent traces |
| `GET` | `/traces/:id` | Get trace with all spans |

### Client SDK

```typescript
import { LoadstarClient } from "@loadstar/client";

const client = new LoadstarClient({ baseUrl: "http://localhost:8787" });

const conv = await client.createConversation("assistant");
const result = await client.sendMessage(conv.id, "Hello!");

// Connect for live events
client.connectRelay(conv.id, result.relayId);
client.on("turn.complete", (event) => {
  console.log("Agent responded:", event.data.content);
});

// Inspect traces
const traces = await client.listTraces();
const trace = await client.getTrace(traces[0].traceId);
console.log(trace.spans); // full waterfall data
```

## Architecture

```
Client ←WebSocket→ Relay DO ←fetch→ Workflow → D1
                                        ↓
                                   AI Gateway
```

- **Worker** — stateless HTTP/WebSocket routing, no durable work
- **Workflow** — runs the agent turn loop; each LLM call and tool execution is a checkpointed step that survives restarts
- **Relay DO** — dumb WebSocket pipe; no state, no logic; if it dies the client reconnects and catches up from the REST API
- **D1** — conversations, messages, and OTel-compatible traces
- **AI Gateway** — inference routing to any model provider

## Custom storage

Implement `ConversationStore` and/or `TraceStore` to use your own database:

```typescript
import { loadstar } from "loadstar";
import type { ConversationStore, TraceStore } from "loadstar";

class MyPostgresStore implements ConversationStore {
  // implement: createConversation, getConversation, listConversations,
  //            addMessage, getMessages
}

const app = loadstar({
  agents: [myAgent],
  store: (env) => new MyPostgresStore(env.DATABASE_URL),
});
```

## License

MIT
