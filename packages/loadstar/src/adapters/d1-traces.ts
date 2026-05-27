import type {
  Span,
  SpanEvent,
  SpanStatus,
  Trace,
  TraceStore,
  TraceWithSpans,
} from "../types.js";

export class D1TraceStore implements TraceStore {
  constructor(private db: D1Database) {}

  async migrate(): Promise<void> {
    await this.db.batch([
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS traces (
          trace_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms REAL,
          input TEXT NOT NULL
        )
      `),
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_traces_started ON traces(started_at DESC)`
      ),
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS spans (
          span_id TEXT PRIMARY KEY,
          trace_id TEXT NOT NULL,
          parent_span_id TEXT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms REAL,
          attributes TEXT NOT NULL DEFAULT '{}',
          events TEXT NOT NULL DEFAULT '[]',
          input TEXT,
          output TEXT,
          error TEXT,
          FOREIGN KEY (trace_id) REFERENCES traces(trace_id)
        )
      `),
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id, started_at ASC)`
      ),
    ]);
  }

  async createTrace(
    trace: Omit<Trace, "endedAt" | "durationMs" | "status"> & {
      status?: SpanStatus;
    }
  ): Promise<Trace> {
    const status = trace.status ?? "running";
    await this.db
      .prepare(
        `INSERT INTO traces (trace_id, conversation_id, agent_name, status, started_at, input)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        trace.traceId,
        trace.conversationId,
        trace.agentName,
        status,
        trace.startedAt,
        trace.input
      )
      .run();

    return {
      ...trace,
      status,
      endedAt: null,
      durationMs: null,
    };
  }

  async endTrace(
    traceId: string,
    status: SpanStatus,
    error?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const trace = await this.db
      .prepare(`SELECT started_at FROM traces WHERE trace_id = ?`)
      .bind(traceId)
      .first<{ started_at: string }>();

    const durationMs = trace
      ? new Date(now).getTime() - new Date(trace.started_at).getTime()
      : null;

    await this.db
      .prepare(
        `UPDATE traces SET status = ?, ended_at = ?, duration_ms = ? WHERE trace_id = ?`
      )
      .bind(status, now, durationMs, traceId)
      .run();

    if (error) {
      await this.db
        .prepare(
          `UPDATE spans SET error = ? WHERE trace_id = ? AND parent_span_id IS NULL AND error IS NULL`
        )
        .bind(error, traceId)
        .run();
    }
  }

  async getTrace(traceId: string): Promise<TraceWithSpans | null> {
    const row = await this.db
      .prepare(`SELECT * FROM traces WHERE trace_id = ?`)
      .bind(traceId)
      .first();
    if (!row) return null;

    const { results: spanRows } = await this.db
      .prepare(
        `SELECT * FROM spans WHERE trace_id = ? ORDER BY started_at ASC`
      )
      .bind(traceId)
      .all();

    return {
      ...this.rowToTrace(row),
      spans: spanRows.map((r) => this.rowToSpan(r)),
    };
  }

  async listTraces(limit = 50): Promise<Trace[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM traces ORDER BY started_at DESC LIMIT ?`)
      .bind(limit)
      .all();
    return results.map((r) => this.rowToTrace(r));
  }

  async createSpan(
    span: Omit<Span, "endedAt" | "durationMs" | "events"> & {
      events?: SpanEvent[];
    }
  ): Promise<Span> {
    const events = span.events ?? [];
    await this.db
      .prepare(
        `INSERT INTO spans (span_id, trace_id, parent_span_id, name, kind, status, started_at, attributes, events, input, output, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        span.spanId,
        span.traceId,
        span.parentSpanId,
        span.name,
        span.kind,
        span.status,
        span.startedAt,
        JSON.stringify(span.attributes),
        JSON.stringify(events),
        span.input,
        span.output,
        span.error
      )
      .run();

    return { ...span, endedAt: null, durationMs: null, events };
  }

  async endSpan(
    spanId: string,
    status: SpanStatus,
    output?: string | null,
    error?: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    const span = await this.db
      .prepare(`SELECT started_at FROM spans WHERE span_id = ?`)
      .bind(spanId)
      .first<{ started_at: string }>();

    const durationMs = span
      ? new Date(now).getTime() - new Date(span.started_at).getTime()
      : null;

    await this.db
      .prepare(
        `UPDATE spans SET status = ?, ended_at = ?, duration_ms = ?, output = COALESCE(?, output), error = COALESCE(?, error)
         WHERE span_id = ?`
      )
      .bind(status, now, durationMs, output ?? null, error ?? null, spanId)
      .run();
  }

  async addSpanEvent(spanId: string, event: SpanEvent): Promise<void> {
    const row = await this.db
      .prepare(`SELECT events FROM spans WHERE span_id = ?`)
      .bind(spanId)
      .first<{ events: string }>();

    const events: SpanEvent[] = row ? JSON.parse(row.events) : [];
    events.push(event);

    await this.db
      .prepare(`UPDATE spans SET events = ? WHERE span_id = ?`)
      .bind(JSON.stringify(events), spanId)
      .run();
  }

  private rowToTrace(row: Record<string, unknown>): Trace {
    return {
      traceId: row.trace_id as string,
      conversationId: row.conversation_id as string,
      agentName: row.agent_name as string,
      status: row.status as SpanStatus,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string) ?? null,
      durationMs: (row.duration_ms as number) ?? null,
      input: row.input as string,
    };
  }

  private rowToSpan(row: Record<string, unknown>): Span {
    return {
      spanId: row.span_id as string,
      traceId: row.trace_id as string,
      parentSpanId: (row.parent_span_id as string) ?? null,
      name: row.name as string,
      kind: row.kind as Span["kind"],
      status: row.status as SpanStatus,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string) ?? null,
      durationMs: (row.duration_ms as number) ?? null,
      attributes: JSON.parse((row.attributes as string) || "{}"),
      events: JSON.parse((row.events as string) || "[]"),
      input: (row.input as string) ?? null,
      output: (row.output as string) ?? null,
      error: (row.error as string) ?? null,
    };
  }
}
