import { z } from "zod";
import type { AgentDefinition, ToolDefinition } from "./types.js";

export function agent(config: AgentDefinition): AgentDefinition {
  return {
    maxTurns: 10,
    ...config,
  };
}

export function tool<TParams extends z.ZodType, TResult = unknown>(
  config: ToolDefinition<TParams, TResult>
): ToolDefinition<TParams, TResult> {
  return config;
}
