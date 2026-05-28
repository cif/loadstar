import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Compass,
  ArrowRight,
  Shield,
  Activity,
  Database,
  Layers,
  Zap,
  GitBranch,
} from "lucide-react";

export function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-border">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Compass className="h-5 w-5" />
          loadstar
        </div>
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <Link to="/arch" className="hover:text-foreground transition-colors">
            Architecture
          </Link>
          <Link to="/demo" className="hover:text-foreground transition-colors">
            Demo
          </Link>
          <a
            href="https://github.com/cif/loadstar"
            target="_blank"
            rel="noopener"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-8 pt-24 pb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-medium mb-8">
          <Shield className="h-3 w-3" />
          Survives deploys, crashes, and restarts
        </div>
        <h1 className="text-5xl font-bold tracking-tight max-w-3xl leading-tight">
          Durable AI agents on{" "}
          <span className="text-orange-400">Cloudflare</span>
        </h1>
        <p className="text-lg text-muted-foreground mt-6 max-w-2xl leading-relaxed">
          Cloudflare's Agents SDK builds on Durable Objects that get killed
          during deployments. Loadstar moves your agent runtime to Workflows —
          every inference call and tool execution is checkpointed and
          recoverable.
        </p>
        <div className="flex gap-3 mt-10">
          <Link to="/demo">
            <Button
              size="lg"
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
            >
              Try the demo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link to="/arch">
            <Button
              size="lg"
              variant="outline"
              className="border-border text-foreground hover:bg-accent gap-2"
            >
              <Layers className="h-4 w-4" />
              Architecture
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="grid grid-cols-3 gap-6 max-w-4xl mx-auto px-8 pb-24">
        <FeatureCard
          icon={Zap}
          title="Step-based durability"
          description="Every LLM call and tool execution is a checkpointed workflow step. If the runtime restarts mid-inference, it retries from the last completed step."
          color="text-emerald-400"
        />
        <FeatureCard
          icon={Activity}
          title="Built-in observability"
          description="OTel-compatible traces stored in D1 with a waterfall viewer. See every span — inference latency, token counts, tool results, error stacks."
          color="text-purple-400"
        />
        <FeatureCard
          icon={Database}
          title="Bring your own storage"
          description="ConversationStore and TraceStore are interfaces. Ship with D1 out of the box, swap to Postgres, Turso, or anything else."
          color="text-blue-400"
        />
        <FeatureCard
          icon={GitBranch}
          title="Minimal DO surface"
          description="A thin relay DO handles WebSocket streaming only — no state, no logic. If it drops during a deploy, the client reconnects and catches up."
          color="text-amber-400"
        />
        <FeatureCard
          icon={Shield}
          title="No vendor SDK lock-in"
          description="Deliberately avoids @cloudflare/agents. Your agents are data, not class hierarchies. Define them as config, run them through a generic workflow."
          color="text-rose-400"
        />
        <FeatureCard
          icon={Layers}
          title="Full agent loop"
          description="Multi-turn conversations with tool use, automatic retries, max turn limits, and real-time event streaming to connected clients."
          color="text-cyan-400"
        />
      </section>

      {/* Code sample */}
      <section className="max-w-3xl mx-auto px-8 pb-24">
        <h2 className="text-2xl font-semibold mb-6 text-center">
          Define an agent in 20 lines
        </h2>
        <pre className="bg-muted/50 border border-border rounded-xl p-6 text-sm text-foreground/80 overflow-x-auto leading-relaxed">
          <code>{`import { loadstar, agent, tool } from "loadstar";
import { z } from "zod";

const app = loadstar({
  agents: [
    agent({
      name: "assistant",
      model: "@cf/meta/llama-3.2-3b-instruct",
      system: "You are a helpful assistant.",
      tools: [
        tool({
          name: "search",
          description: "Search the web",
          parameters: z.object({ query: z.string() }),
          execute: async (params) => {
            // runs as a durable step
            return fetch(\`https://api.search.com?q=\${params.query}\`);
          },
        }),
      ],
    }),
  ],
});`}</code>
        </pre>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-6 text-center text-xs text-muted-foreground">
        loadstar — MIT License —{" "}
        <a
          href="https://github.com/cif/loadstar"
          target="_blank"
          rel="noopener"
          className="underline hover:text-foreground/50"
        >
          github.com/cif/loadstar
        </a>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: typeof Zap;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div className="border border-border rounded-xl p-5 bg-muted/30 hover:bg-muted/50 transition-colors">
      <Icon className={`h-5 w-5 ${color} mb-3`} />
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
