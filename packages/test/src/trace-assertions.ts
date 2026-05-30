import type { Span, SpanKind, SpanStatus, TraceWithSpans } from "loadstar";

export class TraceAssertion {
  constructor(private trace: TraceWithSpans) {}

  get spans() {
    return this.trace.spans;
  }

  hasStatus(status: SpanStatus): this {
    if (this.trace.status !== status) {
      throw new TraceAssertionError(
        `Expected trace status "${status}", got "${this.trace.status}"`,
        this.trace
      );
    }
    return this;
  }

  isOk(): this {
    return this.hasStatus("ok");
  }

  isError(): this {
    return this.hasStatus("error");
  }

  completedIn(maxMs: number): this {
    if (this.trace.durationMs === null) {
      throw new TraceAssertionError("Trace has no duration (still running?)", this.trace);
    }
    if (this.trace.durationMs > maxMs) {
      throw new TraceAssertionError(
        `Expected trace to complete in ${maxMs}ms, took ${this.trace.durationMs}ms`,
        this.trace
      );
    }
    return this;
  }

  hasSpanCount(count: number): this {
    if (this.trace.spans.length !== count) {
      throw new TraceAssertionError(
        `Expected ${count} spans, got ${this.trace.spans.length}`,
        this.trace
      );
    }
    return this;
  }

  hasMinSpans(count: number): this {
    if (this.trace.spans.length < count) {
      throw new TraceAssertionError(
        `Expected at least ${count} spans, got ${this.trace.spans.length}`,
        this.trace
      );
    }
    return this;
  }

  hasSpan(namePattern: string | RegExp): SpanAssertion {
    const span = this.trace.spans.find((s) =>
      typeof namePattern === "string"
        ? s.name.includes(namePattern)
        : namePattern.test(s.name)
    );
    if (!span) {
      const names = this.trace.spans.map((s) => s.name).join(", ");
      throw new TraceAssertionError(
        `No span matching "${namePattern}" found. Spans: [${names}]`,
        this.trace
      );
    }
    return new SpanAssertion(span, this.trace);
  }

  hasNoErrors(): this {
    const errorSpans = this.trace.spans.filter((s) => s.status === "error");
    if (errorSpans.length > 0) {
      const errors = errorSpans
        .map((s) => `  ${s.name}: ${s.error?.slice(0, 100)}`)
        .join("\n");
      throw new TraceAssertionError(
        `Expected no errors, found ${errorSpans.length}:\n${errors}`,
        this.trace
      );
    }
    return this;
  }

  hasSpansInOrder(...namePatterns: (string | RegExp)[]): this {
    let lastIndex = -1;
    for (const pattern of namePatterns) {
      const index = this.trace.spans.findIndex((s, i) =>
        i > lastIndex &&
        (typeof pattern === "string"
          ? s.name.includes(pattern)
          : pattern.test(s.name))
      );
      if (index === -1) {
        throw new TraceAssertionError(
          `Span "${pattern}" not found after index ${lastIndex}`,
          this.trace
        );
      }
      lastIndex = index;
    }
    return this;
  }

  hasToolCall(toolName: string): SpanAssertion {
    const span = this.trace.spans.find(
      (s) => s.kind === "tool" && s.attributes.toolName === toolName
    );
    if (!span) {
      const tools = this.trace.spans
        .filter((s) => s.kind === "tool")
        .map((s) => s.attributes.toolName)
        .join(", ");
      throw new TraceAssertionError(
        `No tool call to "${toolName}" found. Tool calls: [${tools}]`,
        this.trace
      );
    }
    return new SpanAssertion(span, this.trace);
  }

  hasInferenceCount(count: number): this {
    const inferenceSpans = this.trace.spans.filter(
      (s) => s.kind === "inference"
    );
    if (inferenceSpans.length !== count) {
      throw new TraceAssertionError(
        `Expected ${count} inference calls, got ${inferenceSpans.length}`,
        this.trace
      );
    }
    return this;
  }

  totalTokens(): number {
    let total = 0;
    for (const span of this.trace.spans) {
      if (span.kind === "inference" && span.output) {
        try {
          const data = JSON.parse(span.output);
          total += data.usage?.total_tokens ?? 0;
        } catch {
          // ignore
        }
      }
    }
    return total;
  }

  tokensUnder(max: number): this {
    const total = this.totalTokens();
    if (total > max) {
      throw new TraceAssertionError(
        `Expected total tokens under ${max}, got ${total}`,
        this.trace
      );
    }
    return this;
  }
}

export class SpanAssertion {
  constructor(
    private span: Span,
    private trace: TraceWithSpans
  ) {}

  withStatus(status: SpanStatus): this {
    if (this.span.status !== status) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" expected status "${status}", got "${this.span.status}"${this.span.error ? `\n  Error: ${this.span.error.slice(0, 200)}` : ""}`,
        this.trace
      );
    }
    return this;
  }

  isOk(): this {
    return this.withStatus("ok");
  }

  isError(): this {
    return this.withStatus("error");
  }

  tookLessThan(maxMs: number): this {
    if (this.span.durationMs === null) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" has no duration`,
        this.trace
      );
    }
    if (this.span.durationMs > maxMs) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" took ${this.span.durationMs}ms, expected < ${maxMs}ms`,
        this.trace
      );
    }
    return this;
  }

  tookMoreThan(minMs: number): this {
    if (this.span.durationMs === null) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" has no duration`,
        this.trace
      );
    }
    if (this.span.durationMs < minMs) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" took ${this.span.durationMs}ms, expected > ${minMs}ms`,
        this.trace
      );
    }
    return this;
  }

  hasKind(kind: SpanKind): this {
    if (this.span.kind !== kind) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" expected kind "${kind}", got "${this.span.kind}"`,
        this.trace
      );
    }
    return this;
  }

  hasAttribute(key: string, value?: unknown): this {
    if (!(key in this.span.attributes)) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" missing attribute "${key}"`,
        this.trace
      );
    }
    if (value !== undefined && this.span.attributes[key] !== value) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" attribute "${key}" expected ${JSON.stringify(value)}, got ${JSON.stringify(this.span.attributes[key])}`,
        this.trace
      );
    }
    return this;
  }

  hasInput(pattern: string | RegExp): this {
    if (!this.span.input) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" has no input`,
        this.trace
      );
    }
    const matches =
      typeof pattern === "string"
        ? this.span.input.includes(pattern)
        : pattern.test(this.span.input);
    if (!matches) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" input doesn't match "${pattern}".\n  Input: ${this.span.input.slice(0, 200)}`,
        this.trace
      );
    }
    return this;
  }

  hasOutput(pattern: string | RegExp): this {
    if (!this.span.output) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" has no output`,
        this.trace
      );
    }
    const matches =
      typeof pattern === "string"
        ? this.span.output.includes(pattern)
        : pattern.test(this.span.output);
    if (!matches) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" output doesn't match "${pattern}".\n  Output: ${this.span.output.slice(0, 200)}`,
        this.trace
      );
    }
    return this;
  }

  hasError(pattern: string | RegExp): this {
    if (!this.span.error) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" has no error`,
        this.trace
      );
    }
    const matches =
      typeof pattern === "string"
        ? this.span.error.includes(pattern)
        : pattern.test(this.span.error);
    if (!matches) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" error doesn't match "${pattern}".\n  Error: ${this.span.error.slice(0, 200)}`,
        this.trace
      );
    }
    return this;
  }

  hasChildren(count: number): this {
    const children = this.trace.spans.filter(
      (s) => s.parentSpanId === this.span.spanId
    );
    if (children.length !== count) {
      throw new TraceAssertionError(
        `Span "${this.span.name}" expected ${count} children, got ${children.length}`,
        this.trace
      );
    }
    return this;
  }

  child(namePattern: string | RegExp): SpanAssertion {
    const child = this.trace.spans.find(
      (s) =>
        s.parentSpanId === this.span.spanId &&
        (typeof namePattern === "string"
          ? s.name.includes(namePattern)
          : namePattern.test(s.name))
    );
    if (!child) {
      throw new TraceAssertionError(
        `No child span matching "${namePattern}" under "${this.span.name}"`,
        this.trace
      );
    }
    return new SpanAssertion(child, this.trace);
  }

  and(): TraceAssertion {
    return new TraceAssertion(this.trace);
  }
}

export class TraceAssertionError extends Error {
  constructor(
    message: string,
    public trace: TraceWithSpans
  ) {
    super(`${message}\n\n${renderTraceWaterfall(trace)}`);
    this.name = "TraceAssertionError";
  }
}

function renderTraceWaterfall(trace: TraceWithSpans): string {
  const lines: string[] = [
    `── Trace ${trace.traceId.slice(0, 8)} | ${trace.status} | ${trace.durationMs ?? "?"}ms ──`,
    "",
  ];

  const rootSpans = trace.spans.filter((s) => s.parentSpanId === null);
  const childMap = new Map<string, Span[]>();
  for (const span of trace.spans) {
    if (span.parentSpanId) {
      const children = childMap.get(span.parentSpanId) ?? [];
      children.push(span);
      childMap.set(span.parentSpanId, children);
    }
  }

  function renderSpan(span: Span, depth: number) {
    const indent = "  ".repeat(depth);
    const status = span.status === "ok" ? "✓" : span.status === "error" ? "✗" : "…";
    const dur =
      span.durationMs !== null ? `${span.durationMs}ms` : "running";
    lines.push(
      `${indent}${status} ${span.kind.padEnd(10)} ${span.name.padEnd(35)} ${dur.padStart(8)}`
    );
    if (span.error) {
      lines.push(`${indent}  ERROR: ${span.error.split("\n")[0].slice(0, 100)}`);
    }
    const children = childMap.get(span.spanId) ?? [];
    for (const child of children) {
      renderSpan(child, depth + 1);
    }
  }

  for (const span of rootSpans) {
    renderSpan(span, 0);
  }

  return lines.join("\n");
}

export function expectTrace(trace: TraceWithSpans): TraceAssertion {
  return new TraceAssertion(trace);
}
