import type { Conversation, ConversationStore, Message } from "../types.js";

export class D1ConversationStore implements ConversationStore {
  constructor(private db: D1Database) {}

  async migrate(): Promise<void> {
    await this.db.batch([
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          agent_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `),
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          tool_calls TEXT,
          tool_results TEXT,
          seq INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        )
      `),
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq)`
      ),
    ]);
  }

  async createConversation(agentName: string): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO conversations (id, agent_name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`
      )
      .bind(id, agentName, now, now)
      .run();

    return { id, agentName, status: "active", createdAt: now, updatedAt: now };
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = await this.db
      .prepare(`SELECT * FROM conversations WHERE id = ?`)
      .bind(id)
      .first();

    if (!row) return null;
    return this.rowToConversation(row);
  }

  async listConversations(agentName?: string): Promise<Conversation[]> {
    const query = agentName
      ? this.db
          .prepare(
            `SELECT * FROM conversations WHERE agent_name = ? ORDER BY updated_at DESC`
          )
          .bind(agentName)
      : this.db.prepare(
          `SELECT * FROM conversations ORDER BY updated_at DESC`
        );

    const { results } = await query.all();
    return results.map((r) => this.rowToConversation(r));
  }

  async addMessage(
    conversationId: string,
    message: Omit<Message, "id" | "seq" | "createdAt">
  ): Promise<Message> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const seqRow = await this.db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) + 1 as next_seq FROM messages WHERE conversation_id = ?`
      )
      .bind(conversationId)
      .first<{ next_seq: number }>();
    const seq = seqRow?.next_seq ?? 1;

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_results, seq, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          conversationId,
          message.role,
          message.content,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          message.toolResults ? JSON.stringify(message.toolResults) : null,
          seq,
          now
        ),
      this.db
        .prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`)
        .bind(now, conversationId),
    ]);

    return { ...message, id, seq, createdAt: now };
  }

  async getMessages(
    conversationId: string,
    afterSeq?: number
  ): Promise<Message[]> {
    const query = afterSeq
      ? this.db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ? AND seq > ? ORDER BY seq ASC`
          )
          .bind(conversationId, afterSeq)
      : this.db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC`
          )
          .bind(conversationId);

    const { results } = await query.all();
    return results.map((r) => this.rowToMessage(r));
  }

  private rowToConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      agentName: row.agent_name as string,
      status: row.status as "active" | "archived",
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      role: row.role as Message["role"],
      content: row.content as string,
      toolCalls: row.tool_calls
        ? JSON.parse(row.tool_calls as string)
        : undefined,
      toolResults: row.tool_results
        ? JSON.parse(row.tool_results as string)
        : undefined,
      seq: row.seq as number,
      createdAt: row.created_at as string,
    };
  }
}
