import type { CardFix } from "@hako/cards/contract";

/**
 * Why a tool did not run, in words a person can act on. Surfaces map the code: `auth_required` → HTTP 401 for Claude
 * and an `mcp/www_authenticate` error result for ChatGPT (plan E32); `paybox_not_connected` → the Connect PayBox gate
 * (D22, the stored action resumes); the rest → the model reads the message and asks or retries.
 */
export const AGENT_ERROR_CODES = [
  "auth_required",
  "paybox_not_connected",
  "invalid_input",
  "not_found",
  "unsupported",
  "tool_unavailable",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export class AgentToolError extends Error {
  readonly code: AgentErrorCode;
  /** The one named fix a card shows for it, when there is one. */
  readonly fix: CardFix | null;

  constructor(code: AgentErrorCode, message: string, fix: CardFix | null = null) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
    this.fix = fix;
  }
}

export const authRequired = (tool: string): AgentToolError =>
  new AgentToolError("auth_required", `Sign in to Hako to use ${tool}.`, "connect_paybox");

export const payboxNotConnected = (): AgentToolError =>
  new AgentToolError("paybox_not_connected", "Connect PayBox first: this reads or moves money in your PayBox wallet.", "connect_paybox");

export const invalidInput = (message: string): AgentToolError => new AgentToolError("invalid_input", message);
