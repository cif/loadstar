import { useCallback, useEffect, useState } from "react";
import { LoadstarClient } from "@loadstar/client";
import type { Trace, TraceWithSpans } from "@loadstar/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TraceWaterfall } from "./trace-waterfall";
import {
  Activity,
  ArrowLeft,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TracePanelProps {
  client: LoadstarClient | null;
  activeTraceId?: string;
}

export function TracePanel({ client, activeTraceId }: TracePanelProps) {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceWithSpans | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"list" | "detail">("list");

  const refreshTraces = useCallback(async () => {
    if (!client) return;
    try {
      const list = await client.listTraces(20);
      setTraces(list);
    } catch {
      // API not available yet
    }
  }, [client]);

  useEffect(() => {
    refreshTraces();
    const interval = setInterval(refreshTraces, 3000);
    return () => clearInterval(interval);
  }, [refreshTraces]);

  useEffect(() => {
    if (activeTraceId && client) {
      loadTrace(activeTraceId);
    }
  }, [activeTraceId, client]);

  async function loadTrace(traceId: string) {
    if (!client) return;
    setLoading(true);
    try {
      const trace = await client.getTrace(traceId);
      setSelectedTrace(trace);
      setView("detail");
    } catch {
      // trace not found yet, will retry on next poll
    } finally {
      setLoading(false);
    }
  }

  // Auto-refresh the active trace while it's running
  useEffect(() => {
    if (!selectedTrace || selectedTrace.status !== "running" || !client) return;
    const interval = setInterval(async () => {
      try {
        const updated = await client.getTrace(selectedTrace.traceId);
        setSelectedTrace(updated);
        if (updated.status !== "running") clearInterval(interval);
      } catch {
        // ignore
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [selectedTrace?.traceId, selectedTrace?.status, client]);

  if (view === "detail" && selectedTrace) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setView("list");
              setSelectedTrace(null);
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium truncate">
            {selectedTrace.input.slice(0, 40)}
            {selectedTrace.input.length > 40 ? "..." : ""}
          </span>
          {selectedTrace.status === "running" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
          )}
        </div>
        <ScrollArea className="flex-1">
          <TraceWaterfall trace={selectedTrace} />
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4" />
          Traces
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={refreshTraces}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {traces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
            <Activity className="h-8 w-8 mb-2 opacity-20" />
            <p>No traces yet</p>
            <p className="text-xs mt-1">Send a message to generate traces</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {traces.map((trace) => (
              <button
                key={trace.traceId}
                onClick={() => loadTrace(trace.traceId)}
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors border-b text-xs",
                  loading && "opacity-50 pointer-events-none"
                )}
              >
                <TraceStatusIcon status={trace.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">
                      {trace.input.slice(0, 50)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {trace.agentName}
                    </Badge>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {trace.durationMs != null
                        ? formatDuration(trace.durationMs)
                        : "running..."}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function TraceStatusIcon({ status }: { status: string }) {
  if (status === "ok")
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  if (status === "error")
    return <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />;
  return <Loader2 className="h-4 w-4 text-amber-500 animate-spin shrink-0 mt-0.5" />;
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
