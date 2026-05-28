import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Wrench,
  Activity,
  AlertTriangle,
  Clock,
  Zap,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

interface Metrics {
  traces: {
    total: number;
    ok: number;
    errors: number;
    avg_duration_ms: number;
    min_duration_ms: number;
    max_duration_ms: number;
  };
  inference: {
    total: number;
    avg_ms: number;
    min_ms: number;
    max_ms: number;
    errors: number;
  };
  tools: { name: string; calls: number; avg_ms: number; errors: number }[];
  recentInference: { duration_ms: number; started_at: string }[];
  recentTools: {
    name: string;
    duration_ms: number;
    status: string;
    started_at: string;
  }[];
}

export function MetricsDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchMetrics() {
    try {
      const res = await fetch(`${API_URL}/metrics`);
      if (res.ok) setMetrics(await res.json());
    } catch {
      // not available yet
    }
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading metrics...
      </div>
    );
  }

  const inferenceChartData = metrics.recentInference
    .slice()
    .reverse()
    .map((d, i) => ({
      index: i,
      latency: Math.round(d.duration_ms),
      time: new Date(d.started_at).toLocaleTimeString(),
    }));

  const toolChartData = metrics.tools.map((t) => ({
    name: t.name,
    calls: t.calls,
    avg_ms: Math.round(t.avg_ms),
    errors: t.errors,
  }));

  const traceSuccessRate = metrics.traces.total
    ? Math.round((metrics.traces.ok / metrics.traces.total) * 100)
    : 0;

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          icon={Activity}
          label="Total Traces"
          value={metrics.traces.total}
          sub={`${traceSuccessRate}% success`}
        />
        <StatCard
          icon={Clock}
          label="Avg Duration"
          value={`${Math.round(metrics.traces.avg_duration_ms ?? 0)}ms`}
          sub={`${Math.round(metrics.traces.min_duration_ms ?? 0)}-${Math.round(metrics.traces.max_duration_ms ?? 0)}ms range`}
        />
        <StatCard
          icon={Brain}
          label="Inference Calls"
          value={metrics.inference.total}
          sub={`${Math.round(metrics.inference.avg_ms ?? 0)}ms avg`}
        />
        <StatCard
          icon={AlertTriangle}
          label="Errors"
          value={metrics.traces.errors}
          sub={`${metrics.inference.errors} inference failures`}
          error={metrics.traces.errors > 0}
        />
      </div>

      {/* Inference latency chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Inference Latency (last 50 calls)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inferenceChartData.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">
              No inference data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={inferenceChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} unit="ms" width={50} />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                  formatter={(v: number) => [`${v}ms`, "Latency"]}
                />
                <Bar
                  dataKey="latency"
                  fill="oklch(0.627 0.194 149.214)"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tool performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Tool Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {toolChartData.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">
              No tool call data yet
            </div>
          ) : (
            <div className="space-y-3">
              {toolChartData.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      {tool.name}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{tool.calls} calls</span>
                    <span>{tool.avg_ms}ms avg</span>
                    {tool.errors > 0 && (
                      <span className="text-destructive">
                        {tool.errors} errors
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent tool calls */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent Tool Calls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {metrics.recentTools.slice(0, 10).map((t, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-xs py-1"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${t.status === "ok" ? "bg-emerald-500" : "bg-destructive"}`}
                  />
                  <span className="font-mono">{t.name}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{Math.round(t.duration_ms)}ms</span>
                  <span>{new Date(t.started_at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  error,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  sub: string;
  error?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div
          className={`text-xl font-semibold ${error ? "text-destructive" : ""}`}
        >
          {value}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}
