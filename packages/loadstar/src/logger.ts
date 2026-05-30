import type { SpanEvent, TraceStore } from "./types.js";

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  traceId: string;
  spanId: string;
}

export class WorkflowLogger {
  private buffer: LogEntry[] = [];
  private currentTraceId: string | null = null;
  private currentSpanId: string | null = null;
  private originals: Record<LogLevel, (...args: unknown[]) => void> = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  setContext(traceId: string, spanId: string): void {
    this.currentTraceId = traceId;
    this.currentSpanId = spanId;
  }

  clearContext(): void {
    this.currentTraceId = null;
    this.currentSpanId = null;
  }

  install(): void {
    for (const level of Object.keys(this.originals) as LogLevel[]) {
      console[level] = (...args: unknown[]) => {
        this.originals[level](...args);

        if (this.currentTraceId && this.currentSpanId) {
          this.buffer.push({
            level,
            message: args
              .map((a) =>
                typeof a === "string" ? a : JSON.stringify(a)
              )
              .join(" "),
            timestamp: new Date().toISOString(),
            traceId: this.currentTraceId,
            spanId: this.currentSpanId,
          });
        }
      };
    }
  }

  uninstall(): void {
    for (const level of Object.keys(this.originals) as LogLevel[]) {
      console[level] = this.originals[level];
    }
  }

  async flush(traceStore: TraceStore): Promise<void> {
    const entries = this.buffer.splice(0);
    for (const entry of entries) {
      const event: SpanEvent = {
        name: `console.${entry.level}`,
        timestamp: entry.timestamp,
        attributes: {
          level: entry.level,
          message: entry.message,
        },
      };
      await traceStore.addSpanEvent(entry.spanId, event);
    }
  }

  getBuffer(): LogEntry[] {
    return [...this.buffer];
  }
}
