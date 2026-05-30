export interface MockToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MockTurn {
  content?: string;
  toolCalls?: MockToolCall[];
}

export interface ConversationScript {
  turns: MockTurn[];
}

export function script(turns: MockTurn[]): ConversationScript {
  return { turns };
}

export function reply(content: string): MockTurn {
  return { content };
}

export function toolCall(
  name: string,
  args: Record<string, unknown>,
  content?: string
): MockTurn {
  return {
    content: content ?? "",
    toolCalls: [{ name, arguments: args }],
  };
}

export function multiToolCall(
  calls: { name: string; arguments: Record<string, unknown> }[],
  content?: string
): MockTurn {
  return { content: content ?? "", toolCalls: calls };
}

let callCounter = 0;

export class MockInferenceServer {
  private scripts: Map<string, { script: ConversationScript; turnIndex: number }> =
    new Map();
  private defaultScript: ConversationScript | null = null;
  private allRequests: {
    body: Record<string, unknown>;
    response: Record<string, unknown>;
    timestamp: number;
  }[] = [];
  private server: { stop: () => void } | null = null;
  private port = 0;

  useScript(script: ConversationScript): this {
    this.defaultScript = script;
    return this;
  }

  useScriptForAgent(agentName: string, s: ConversationScript): this {
    this.scripts.set(agentName, { script: s, turnIndex: 0 });
    return this;
  }

  get requests() {
    return this.allRequests;
  }

  get url() {
    return `http://localhost:${this.port}`;
  }

  reset() {
    this.allRequests = [];
    for (const entry of this.scripts.values()) {
      entry.turnIndex = 0;
    }
    callCounter = 0;
  }

  buildResponse(turn: MockTurn): Record<string, unknown> {
    const toolCalls = turn.toolCalls?.map((tc) => ({
      id: `call_mock_${++callCounter}`,
      type: "function",
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));

    return {
      id: `mock-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "mock-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: turn.content ?? null,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: toolCalls ? "tool_calls" : "stop",
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      },
    };
  }

  getNextTurn(agentName?: string): MockTurn {
    if (agentName && this.scripts.has(agentName)) {
      const entry = this.scripts.get(agentName)!;
      const turn =
        entry.script.turns[entry.turnIndex] ??
        entry.script.turns[entry.script.turns.length - 1];
      entry.turnIndex++;
      return turn;
    }

    if (this.defaultScript) {
      const key = "__default__";
      if (!this.scripts.has(key)) {
        this.scripts.set(key, { script: this.defaultScript, turnIndex: 0 });
      }
      const entry = this.scripts.get(key)!;
      const turn =
        entry.script.turns[entry.turnIndex] ??
        entry.script.turns[entry.script.turns.length - 1];
      entry.turnIndex++;
      return turn;
    }

    return { content: "Mock response (no script configured)" };
  }

  createFetchHandler(): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
      const body = (await request.json()) as Record<string, unknown>;
      const turn = this.getNextTurn();
      const response = this.buildResponse(turn);

      this.allRequests.push({
        body,
        response,
        timestamp: Date.now(),
      });

      return new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      });
    };
  }
}

export function createMockInference(): MockInferenceServer {
  return new MockInferenceServer();
}
