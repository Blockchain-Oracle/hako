import { z } from "zod";

/**
 * Every Hako tool name (plan E30), so a card, the MCP view and the CLI can name a tool without importing the
 * server-only registry. @hako/agent's registry is keyed by exactly this list (a missing or extra tool fails its
 * typecheck).
 */

/** Model-visible tools: the model may call them; drafts and reads are read-only, `hako_execute` is the one that pays. */
export const MODEL_TOOL_NAMES = [
  "hako_discover",
  "hako_inspect",
  "hako_run",
  "hako_markets",
  "hako_chain_read",
  "hako_portfolio",
  "hako_activity",
  "hako_passport",
  "hako_contacts",
  "hako_fund",
  "hako_limit",
  "hako_draft_send",
  "hako_draft_swap",
  "hako_draft_bridge",
  "hako_draft_earn_deposit",
  "hako_draft_earn_withdraw",
  "hako_draft_invoice",
  "hako_execute",
  "hako_receipt",
  "hako_broadcast",
] as const;

/** App-only tools (`_meta.ui.visibility: ["app"]`): called by card buttons and edits, never by the model. */
export const APP_TOOL_NAMES = ["hako_draft_update", "hako_routes", "hako_request_status", "hako_refresh"] as const;

export const HAKO_TOOL_NAMES = [...MODEL_TOOL_NAMES, ...APP_TOOL_NAMES] as const;
export type ModelToolName = (typeof MODEL_TOOL_NAMES)[number];
export type AppToolName = (typeof APP_TOOL_NAMES)[number];
export type HakoToolName = (typeof HAKO_TOOL_NAMES)[number];
export const hakoToolNameSchema = z.enum(HAKO_TOOL_NAMES);

/** Who may call a tool (MCP Apps `_meta.ui.visibility`). */
export const TOOL_VISIBILITIES = ["model", "app"] as const;
export type ToolVisibility = (typeof TOOL_VISIBILITIES)[number];

/**
 * Auth per tool (plan E32): `optional` tools run anonymously and also with a Hako session (ChatGPT `securitySchemes`
 * noauth + oauth2: discover, inspect, markets, chain reads, drafts); `required` tools need a signed-in Hako user with
 * PayBox connected (oauth2 only: execute, status, receipts, broadcast, portfolio, activity, passport, contacts, fund,
 * limit). An anonymous call to a `required` tool is answered with HTTP 401 for Claude and an `mcp/www_authenticate`
 * error result for ChatGPT, before the tool runs.
 */
export const TOOL_AUTH = ["optional", "required"] as const;
export type ToolAuth = (typeof TOOL_AUTH)[number];
