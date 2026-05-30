import type { LogLevel } from "../logger.js";

export interface WorkerLog {
  id: string;
  level: LogLevel;
  message: string;
  traceId: string | null;
  source: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export class D1LogStore {
  constructor(private db: D1Database) {}

  async migrate(): Promise<void> {
    await this.db.batch([
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS worker_logs (
          id TEXT PRIMARY KEY,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          trace_id TEXT,
          source TEXT NOT NULL DEFAULT 'worker',
          timestamp TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}'
        )
      `),
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_worker_logs_ts ON worker_logs(timestamp DESC)`
      ),
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_worker_logs_trace ON worker_logs(trace_id)`
      ),
    ]);
  }

  async write(
    level: LogLevel,
    message: string,
    options: {
      traceId?: string;
      source?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO worker_logs (id, level, message, trace_id, source, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        level,
        message,
        options.traceId ?? null,
        options.source ?? "worker",
        new Date().toISOString(),
        JSON.stringify(options.metadata ?? {})
      )
      .run();
  }

  async query(options: {
    traceId?: string;
    level?: LogLevel;
    source?: string;
    limit?: number;
    since?: string;
  } = {}): Promise<WorkerLog[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.traceId) {
      conditions.push("trace_id = ?");
      params.push(options.traceId);
    }
    if (options.level) {
      conditions.push("level = ?");
      params.push(options.level);
    }
    if (options.source) {
      conditions.push("source = ?");
      params.push(options.source);
    }
    if (options.since) {
      conditions.push("timestamp > ?");
      params.push(options.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 100;

    const query = this.db
      .prepare(
        `SELECT * FROM worker_logs ${where} ORDER BY timestamp DESC LIMIT ?`
      )
      .bind(...params, limit);

    const { results } = await query.all();
    return results.map((r) => ({
      id: r.id as string,
      level: r.level as LogLevel,
      message: r.message as string,
      traceId: (r.trace_id as string) ?? null,
      source: r.source as string,
      timestamp: r.timestamp as string,
      metadata: JSON.parse((r.metadata as string) || "{}"),
    }));
  }
}
