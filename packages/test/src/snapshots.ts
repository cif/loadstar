import type { Message, TraceWithSpans } from "loadstar";

export interface ConversationSnapshot {
  name: string;
  agentName: string;
  messages: Message[];
  trace: TraceWithSpans;
  recordedAt: string;
}

export function createSnapshot(
  name: string,
  agentName: string,
  messages: Message[],
  trace: TraceWithSpans
): ConversationSnapshot {
  return {
    name,
    agentName,
    messages,
    trace,
    recordedAt: new Date().toISOString(),
  };
}

export function assertSnapshotMessages(
  actual: Message[],
  expected: Message[],
  options: { ignoreTimestamps?: boolean; ignoreIds?: boolean } = {}
): void {
  const { ignoreTimestamps = true, ignoreIds = true } = options;

  if (actual.length !== expected.length) {
    throw new Error(
      `Message count mismatch: expected ${expected.length}, got ${actual.length}\n` +
        `Expected roles: [${expected.map((m) => m.role).join(", ")}]\n` +
        `Actual roles:   [${actual.map((m) => m.role).join(", ")}]`
    );
  }

  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];

    if (a.role !== e.role) {
      throw new Error(
        `Message ${i}: expected role "${e.role}", got "${a.role}"`
      );
    }

    if (a.content !== e.content) {
      throw new Error(
        `Message ${i} (${a.role}): content mismatch\n` +
          `  Expected: ${e.content.slice(0, 100)}\n` +
          `  Actual:   ${a.content.slice(0, 100)}`
      );
    }

    const aToolNames = (a.toolCalls ?? []).map((t) => t.name).sort();
    const eToolNames = (e.toolCalls ?? []).map((t) => t.name).sort();
    if (JSON.stringify(aToolNames) !== JSON.stringify(eToolNames)) {
      throw new Error(
        `Message ${i}: tool calls mismatch\n` +
          `  Expected: [${eToolNames.join(", ")}]\n` +
          `  Actual:   [${aToolNames.join(", ")}]`
      );
    }

    const aResultNames = (a.toolResults ?? []).map((t) => t.name).sort();
    const eResultNames = (e.toolResults ?? []).map((t) => t.name).sort();
    if (JSON.stringify(aResultNames) !== JSON.stringify(eResultNames)) {
      throw new Error(
        `Message ${i}: tool results mismatch\n` +
          `  Expected: [${eResultNames.join(", ")}]\n` +
          `  Actual:   [${aResultNames.join(", ")}]`
      );
    }
  }
}

export function assertSnapshotShape(
  actual: Message[],
  expectedShape: { role: string; hasToolCalls?: boolean; contentPattern?: string | RegExp }[]
): void {
  if (actual.length !== expectedShape.length) {
    throw new Error(
      `Message count mismatch: expected ${expectedShape.length}, got ${actual.length}\n` +
        `Expected: [${expectedShape.map((s) => s.role).join(", ")}]\n` +
        `Actual:   [${actual.map((m) => m.role).join(", ")}]`
    );
  }

  for (let i = 0; i < actual.length; i++) {
    const msg = actual[i];
    const shape = expectedShape[i];

    if (msg.role !== shape.role) {
      throw new Error(
        `Message ${i}: expected role "${shape.role}", got "${msg.role}"`
      );
    }

    if (shape.hasToolCalls !== undefined) {
      const has = (msg.toolCalls?.length ?? 0) > 0;
      if (has !== shape.hasToolCalls) {
        throw new Error(
          `Message ${i}: expected ${shape.hasToolCalls ? "tool calls" : "no tool calls"}, got ${has ? "tool calls" : "none"}`
        );
      }
    }

    if (shape.contentPattern) {
      const matches =
        typeof shape.contentPattern === "string"
          ? msg.content.includes(shape.contentPattern)
          : shape.contentPattern.test(msg.content);
      if (!matches) {
        throw new Error(
          `Message ${i}: content doesn't match "${shape.contentPattern}"\n  Content: ${msg.content.slice(0, 100)}`
        );
      }
    }
  }
}
