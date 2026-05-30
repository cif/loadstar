export class WorkflowEntrypoint {
  protected ctx: unknown = {};
  protected env: unknown = {};
  async run(_event: unknown, _step: unknown): Promise<unknown> {
    throw new Error("WorkflowEntrypoint stub — not for direct use in tests");
  }
}

export class DurableObject {
  protected ctx: unknown = {};
  protected env: unknown = {};
  async fetch(_request: Request): Promise<Response> {
    throw new Error("DurableObject stub — not for direct use in tests");
  }
}
