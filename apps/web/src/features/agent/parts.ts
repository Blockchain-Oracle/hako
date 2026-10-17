import { isToolUIPart, type UIMessage } from "ai";

import { RunOutputSchema, type RunProposal } from "@/lib/agent/schemas";

type Part = UIMessage["parts"][number];

export type ToolName = "find_tools" | "inspect_tool" | "run_tool";

export interface ToolPart {
  type: `tool-${ToolName}`;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
}

export function asToolPart(part: Part): ToolPart | null {
  return isToolUIPart(part) ? (part as unknown as ToolPart) : null;
}

export const toolName = (part: ToolPart): ToolName => part.type.slice("tool-".length) as ToolName;

export const isRunning = (part: ToolPart): boolean => part.state === "input-streaming" || part.state === "input-available";

/** A run_tool part's proposal once the server has answered (none while in flight, once trimmed, or unrecognised). */
export function runOutput(part: ToolPart): RunProposal | null {
  const parsed = RunOutputSchema.safeParse(part.output);
  if (!parsed.success || "trimmed" in parsed.data) return null;
  return parsed.data;
}
