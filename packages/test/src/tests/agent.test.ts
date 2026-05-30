import { describe, it, expect } from "vitest";
import { z } from "zod";
import { agent, tool } from "loadstar";
import {
  createMockInference,
  script,
  reply,
  toolCall,
  simulateAgent,
  chaosTest,
  expectTrace,
  assertSnapshotShape,
} from "../index.js";

const calculator = tool({
  name: "calculate",
  description: "Perform a calculation",
  parameters: z.object({
    expression: z.string(),
  }),
  execute: async (params) => {
    const tokens = params.expression.match(/(\d+\.?\d*|[+\-*/])/g);
    if (!tokens) return { error: "Invalid expression" };
    let result = parseFloat(tokens[0]);
    for (let i = 1; i < tokens.length; i += 2) {
      const op = tokens[i];
      const num = parseFloat(tokens[i + 1]);
      if (op === "+") result += num;
      else if (op === "-") result -= num;
      else if (op === "*") result *= num;
      else if (op === "/") result /= num;
    }
    return { result: String(result) };
  },
});

const testAgent = agent({
  name: "test-agent",
  model: "mock-model",
  system: "You are a helpful assistant.",
  tools: [calculator],
  maxTurns: 5,
});

describe("Mock Inference", () => {
  it("returns scripted responses in order", () => {
    const mock = createMockInference().useScript(
      script([reply("Hello!"), reply("How can I help?")])
    );

    const turn1 = mock.getNextTurn();
    expect(turn1.content).toBe("Hello!");

    const turn2 = mock.getNextTurn();
    expect(turn2.content).toBe("How can I help?");
  });

  it("repeats last turn when script is exhausted", () => {
    const mock = createMockInference().useScript(script([reply("Only response")]));

    mock.getNextTurn();
    const turn2 = mock.getNextTurn();
    expect(turn2.content).toBe("Only response");
  });

  it("generates tool call responses", () => {
    const mock = createMockInference().useScript(
      script([toolCall("calculate", { expression: "2 + 2" })])
    );

    const response = mock.buildResponse(mock.getNextTurn());
    const choice = (response as any).choices[0];
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message.tool_calls[0].function.name).toBe("calculate");
  });
});

describe("Workflow Simulation", () => {
  it("completes a simple conversation", async () => {
    const mock = createMockInference().useScript(
      script([reply("The answer is 42.")])
    );

    const result = await simulateAgent(testAgent, mock).run("What is the meaning of life?");

    expect(result.completed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.finalMessages).toHaveLength(2); // user + assistant
    expect(result.finalMessages[1].content).toBe("The answer is 42.");
  });

  it("handles tool calls and continues", async () => {
    const mock = createMockInference().useScript(
      script([
        toolCall("calculate", { expression: "6 * 7" }),
        reply("6 * 7 = 42"),
      ])
    );

    const result = await simulateAgent(testAgent, mock).run("What is 6 * 7?");

    expect(result.completed).toBe(true);

    assertSnapshotShape(result.finalMessages, [
      { role: "user" },
      { role: "assistant", hasToolCalls: true },
      { role: "tool" },
      { role: "assistant", contentPattern: "42" },
    ]);
  });

  it("respects maxTurns", async () => {
    const infiniteToolAgent = agent({
      ...testAgent,
      maxTurns: 3,
    });

    const mock = createMockInference().useScript(
      script([toolCall("calculate", { expression: "1 + 1" })])
    );

    const result = await simulateAgent(infiniteToolAgent, mock).run("Loop forever");

    expect(result.completed).toBe(true);
    const assistantMsgs = result.finalMessages.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Crash Simulation", () => {
  it("recovers from crash after step 2", async () => {
    const mock = createMockInference().useScript(
      script([reply("Hello!")])
    );

    const result = await simulateAgent(testAgent, mock)
      .crashAfterStep(2)
      .run("Hi");

    expect(result.completed).toBe(true);
    expect(result.replays).toBe(1);
    expect(result.finalMessages[1].content).toBe("Hello!");
  });

  it("recovers from crash mid-tool-call", async () => {
    const mock = createMockInference().useScript(
      script([
        toolCall("calculate", { expression: "3 + 4" }),
        reply("3 + 4 = 7"),
      ])
    );

    const result = await simulateAgent(testAgent, mock)
      .crashAfterStep(4) // crash after inference, before tool
      .run("What is 3 + 4?");

    expect(result.completed).toBe(true);
    expect(result.replays).toBe(1);

    const finalAssistant = result.finalMessages.filter(
      (m) => m.role === "assistant" && m.content && !m.toolCalls?.length
    );
    expect(finalAssistant.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Chaos Testing", () => {
  it("survives crashes at every possible step", async () => {
    const mock = createMockInference().useScript(
      script([reply("Chaos survived!")])
    );

    const result = await chaosTest(testAgent, mock, "Test chaos");

    expect(result.allCompleted).toBe(true);
    expect(result.deterministic).toBe(true);
    expect(result.runs.length).toBeGreaterThan(1);
  });

  it("survives chaos with tool calls", async () => {
    const mock = createMockInference().useScript(
      script([
        toolCall("calculate", { expression: "10 * 5" }),
        reply("10 * 5 = 50"),
      ])
    );

    const result = await chaosTest(testAgent, mock, "What is 10 * 5?");

    expect(result.allCompleted).toBe(true);
    console.log(result.summary);
  });
});

describe("Trace Assertions", () => {
  it("asserts on trace structure", async () => {
    const mock = createMockInference().useScript(
      script([
        toolCall("calculate", { expression: "2 + 2" }),
        reply("2 + 2 = 4"),
      ])
    );

    const result = await simulateAgent(testAgent, mock).run("What is 2 + 2?");
    const trace = result.trace!;

    expectTrace(trace)
      .isOk()
      .hasNoErrors()
      .hasSpan("inference-1")
        .hasKind("inference")
        .hasAttribute("model", "mock-model")
        .hasAttribute("turn", 1)
        .and()
      .hasSpan("inference-2")
        .hasKind("inference")
        .hasAttribute("turn", 2);
  });

  it("pretty-prints waterfall on failure", async () => {
    const mock = createMockInference().useScript(script([reply("Hi")]));
    const result = await simulateAgent(testAgent, mock).run("Hello");
    const trace = result.trace!;

    expect(() => {
      expectTrace(trace).hasSpan("nonexistent-span");
    }).toThrow(/nonexistent-span/);
  });
});
