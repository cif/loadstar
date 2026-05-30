import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Database,
  AlertTriangle,
  Wrench,
  Cog,
  Layers,
} from "lucide-react";
import { useState } from "react";
import type { Span, TraceWithSpans } from "@loadstar/client";

interface TraceWaterfallProps {
  trace: TraceWithSpans;
}

const KIND_CONFIG: Record<
  string,
  { icon: typeof Brain; color: string; bg: string; label: string }
> = {
  workflow: {
    icon: Layers,
    color: "text-blue-500",
    bg: "bg-blue-500",
    label: "Workflow",
  },
  inference: {
    icon: Brain,
    color: "text-purple-500",
    bg: "bg-purple-500",
    label: "Inference",
  },
  tool: {
    icon: Wrench,
    color: "text-amber-500",
    bg: "bg-amber-500",
    label: "Tool",
  },
  persist: {
    icon: Database,
    color: "text-emerald-500",
    bg: "bg-emerald-500",
    label: "Storage",
  },
  system: {
    icon: Cog,
    color: "text-slate-500",
    bg: "bg-slate-500",
    label: "System",
  },
};

export function TraceWaterfall({ trace }: TraceWaterfallProps) {
  const traceStart = new Date(trace.startedAt).getTime();
  const traceEnd = trace.endedAt
    ? new Date(trace.endedAt).getTime()
    : Date.now();
  const traceDuration = traceEnd - traceStart;

  const rootSpans = trace.spans.filter((s) => s.parentSpanId === null);
  const childMap = new Map<string, Span[]>();
  for (const span of trace.spans) {
    if (span.parentSpanId) {
      const children = childMap.get(span.parentSpanId) ?? [];
      children.push(span);
      childMap.set(span.parentSpanId, children);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground border-b">
        <div className="flex items-center gap-2">
          <StatusDot status={trace.status} />
          <span className="font-mono">{trace.traceId.slice(0, 8)}</span>
          <Badge
            variant={trace.status === "error" ? "destructive" : "secondary"}
            className="text-[10px] px-1.5 py-0"
          >
            {trace.status}
          </Badge>
        </div>
        <span>
          {trace.durationMs != null
            ? formatDuration(trace.durationMs)
            : "running..."}
        </span>
      </div>

      <div className="flex flex-col">
        {rootSpans.map((span) => (
          <SpanRow
            key={span.spanId}
            span={span}
            childMap={childMap}
            traceStart={traceStart}
            traceDuration={traceDuration}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}

interface SpanRowProps {
  span: Span;
  childMap: Map<string, Span[]>;
  traceStart: number;
  traceDuration: number;
  depth: number;
}

function SpanRow({
  span,
  childMap,
  traceStart,
  traceDuration,
  depth,
}: SpanRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const children = childMap.get(span.spanId) ?? [];
  const hasChildren = children.length > 0;
  const config = KIND_CONFIG[span.kind] ?? KIND_CONFIG.system;
  const Icon = config.icon;

  const spanStart = new Date(span.startedAt).getTime();
  const spanEnd = span.endedAt ? new Date(span.endedAt).getTime() : Date.now();
  const offsetPct = ((spanStart - traceStart) / traceDuration) * 100;
  const widthPct = Math.max(
    ((spanEnd - spanStart) / traceDuration) * 100,
    0.5
  );

  const displayName = span.name
    .replace(/^(tool|inference|persist)-\d+-/, "")
    .replace(/-[a-f0-9-]{36}$/, "");

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 hover:bg-muted/50 cursor-pointer group text-xs transition-colors",
          span.status === "error" && "bg-destructive/5"
        )}
        onClick={() => setDetailOpen(!detailOpen)}
      >
        <div
          className="flex items-center gap-1 shrink-0"
          style={{ paddingLeft: `${depth * 16}px`, width: "200px" }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="p-0.5 hover:bg-muted rounded"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <Icon className={cn("h-3.5 w-3.5 shrink-0", config.color)} />
          <span className="truncate font-medium">{displayName}</span>
          {span.status === "error" && (
            <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
          )}
          {span.events.filter((e) => e.name.startsWith("console.")).length > 0 && (
            <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground shrink-0">
              {span.events.filter((e) => e.name.startsWith("console.")).length} logs
            </span>
          )}
        </div>

        <div className="flex-1 h-5 relative">
          <div
            className={cn(
              "absolute top-1 h-3 rounded-sm transition-all",
              span.status === "error"
                ? "bg-destructive/60"
                : span.status === "running"
                  ? `${config.bg}/40 animate-pulse`
                  : `${config.bg}/60`
            )}
            style={{
              left: `${offsetPct}%`,
              width: `${widthPct}%`,
              minWidth: "2px",
            }}
          />
        </div>

        <span className="text-muted-foreground w-16 text-right shrink-0 tabular-nums">
          {span.durationMs != null ? formatDuration(span.durationMs) : "..."}
        </span>
      </div>

      {detailOpen && <SpanDetail span={span} />}

      {expanded &&
        children.map((child) => (
          <SpanRow
            key={child.spanId}
            span={child}
            childMap={childMap}
            traceStart={traceStart}
            traceDuration={traceDuration}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function SpanDetail({ span }: { span: Span }) {
  return (
    <div className="mx-2 mb-1 p-3 rounded-md border bg-muted/30 text-xs space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <DetailField label="Span ID" value={span.spanId.slice(0, 12)} mono />
        <DetailField label="Kind" value={span.kind} />
        <DetailField label="Status" value={span.status} />
        <DetailField
          label="Duration"
          value={
            span.durationMs != null ? formatDuration(span.durationMs) : "—"
          }
        />
        {Object.entries(span.attributes).map(([k, v]) => (
          <DetailField key={k} label={k} value={String(v)} />
        ))}
      </div>

      {span.input && (
        <DetailBlock label="Input" content={span.input} />
      )}
      {span.output && (
        <DetailBlock label="Output" content={span.output} />
      )}
      {span.error && (
        <div>
          <span className="text-destructive font-medium">Error</span>
          <pre className="mt-1 p-2 rounded bg-destructive/10 text-destructive whitespace-pre-wrap break-all font-mono text-[11px] max-h-40 overflow-auto">
            {span.error}
          </pre>
        </div>
      )}
      {span.events.length > 0 && (() => {
        const consoleLogs = span.events.filter((e) => e.name.startsWith("console."));
        const otherEvents = span.events.filter((e) => !e.name.startsWith("console."));

        return (
          <>
            {consoleLogs.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">Console</span>
                <div className="mt-1 rounded bg-[#1e1e1e] dark:bg-[#0d0d0d] p-2 font-mono text-[11px] max-h-48 overflow-auto space-y-0.5">
                  {consoleLogs.map((evt, i) => {
                    const level = (evt.attributes?.level as string) ?? "log";
                    const message = (evt.attributes?.message as string) ?? evt.name;
                    return (
                      <div key={i} className="flex gap-2">
                        <span className="text-muted-foreground/60 shrink-0">
                          {new Date(evt.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <span className={cn(
                          level === "error" && "text-red-400",
                          level === "warn" && "text-yellow-400",
                          level === "info" && "text-blue-400",
                          level === "debug" && "text-gray-500",
                          level === "log" && "text-gray-300",
                        )}>
                          {message}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {otherEvents.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">Events</span>
                <div className="mt-1 space-y-1">
                  {otherEvents.map((evt, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-[11px] text-muted-foreground"
                    >
                      <span className="font-mono">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                      <span>{evt.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("truncate", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function DetailBlock({ label, content }: { label: string; content: string }) {
  let formatted = content;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    // not JSON, show as-is
  }
  return (
    <div>
      <span className="font-medium text-muted-foreground">{label}</span>
      <pre className="mt-1 p-2 rounded bg-muted whitespace-pre-wrap break-all font-mono text-[11px] max-h-40 overflow-auto">
        {formatted}
      </pre>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        status === "ok" && "bg-emerald-500",
        status === "error" && "bg-destructive",
        status === "running" && "bg-amber-500 animate-pulse"
      )}
    />
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
