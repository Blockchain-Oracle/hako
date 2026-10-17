import { HAKO_TOOL_NAMES, type HakoToolName, type StructuredContent, type ToolVisibility } from "@hako/cards/contract";
import { z } from "zod";

import type { HakoTool } from "./define.ts";
import type { AgentDeps } from "./deps.ts";
import { authRequired, invalidInput } from "./errors.ts";
import { hakoActivity, hakoFund, hakoLimit, hakoPortfolio } from "./tools/account.ts";
import { hakoDraftUpdate, hakoRefresh, hakoRoutes } from "./tools/app.ts";
import { hakoDiscover, hakoInspect, hakoRun } from "./tools/catalog.ts";
import { hakoContacts } from "./tools/contacts.ts";
import {
  hakoDraftBridge,
  hakoDraftEarnDeposit,
  hakoDraftEarnWithdraw,
  hakoDraftInvoice,
  hakoDraftSend,
  hakoDraftSwap,
} from "./tools/drafts.ts";
import { hakoBroadcast, hakoExecute, hakoReceipt, hakoRequestStatus } from "./tools/execute.ts";
import { hakoPassport } from "./tools/passport.ts";
import { hakoChainRead, hakoMarkets } from "./tools/reads.ts";

/**
 * The one tool registry (plan E30, §5b `@hako/agent`): `/agent`, voice, the hosted MCP server and `hako mcp` all
 * serve exactly these tools. Keyed by the contract's tool names: a missing tool, an extra one or a key that differs
 * from its tool's name fails the typecheck.
 */
export const HAKO_TOOLS = {
  hako_discover: hakoDiscover,
  hako_inspect: hakoInspect,
  hako_run: hakoRun,
  hako_markets: hakoMarkets,
  hako_chain_read: hakoChainRead,
  hako_portfolio: hakoPortfolio,
  hako_activity: hakoActivity,
  hako_passport: hakoPassport,
  hako_contacts: hakoContacts,
  hako_fund: hakoFund,
  hako_limit: hakoLimit,
  hako_draft_send: hakoDraftSend,
  hako_draft_swap: hakoDraftSwap,
  hako_draft_bridge: hakoDraftBridge,
  hako_draft_earn_deposit: hakoDraftEarnDeposit,
  hako_draft_earn_withdraw: hakoDraftEarnWithdraw,
  hako_draft_invoice: hakoDraftInvoice,
  hako_execute: hakoExecute,
  hako_receipt: hakoReceipt,
  hako_broadcast: hakoBroadcast,
  hako_draft_update: hakoDraftUpdate,
  hako_routes: hakoRoutes,
  hako_request_status: hakoRequestStatus,
  hako_refresh: hakoRefresh,
} as const satisfies { [N in HakoToolName]: HakoTool<z.ZodType, z.ZodType, N> };

export type HakoTools = typeof HAKO_TOOLS;
export type ToolInput<N extends HakoToolName> = z.input<HakoTools[N]["input"]>;
export type ToolOutput<N extends HakoToolName> = z.output<HakoTools[N]["output"]>;

/** Every tool, in the contract's order; only the ones a caller may see when `visibility` is given. */
export function listTools(visibility?: ToolVisibility): HakoTool[] {
  const tools: HakoTool[] = HAKO_TOOL_NAMES.map((name) => HAKO_TOOLS[name]);
  return visibility ? tools.filter((tool) => tool.visibility.includes(visibility)) : tools;
}

export function getTool(name: string): HakoTool | null {
  return Object.hasOwn(HAKO_TOOLS, name) ? HAKO_TOOLS[name as HakoToolName] : null;
}

function isAsyncGenerator<T>(value: unknown): value is AsyncGenerator<T> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/**
 * Runs a tool for any surface: checks auth, parses the input with the tool's schema, executes it with the injected
 * deps and checks every card it returns against the tool's output schema. Yields once for a plain tool and once per
 * snapshot for a streaming one (`hako_routes`).
 */
export async function* streamTool(name: HakoToolName, rawInput: unknown, deps: AgentDeps): AsyncGenerator<StructuredContent> {
  const tool: HakoTool = HAKO_TOOLS[name];
  if (tool.auth === "required" && !deps.user) throw authRequired(name);
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) throw invalidInput(`${name}: ${z.prettifyError(parsed.error)}`);
  const result = tool.execute(parsed.data, deps);
  if (isAsyncGenerator(result)) {
    for await (const snapshot of result) yield tool.output.parse(snapshot) as StructuredContent;
    return;
  }
  yield tool.output.parse(await result) as StructuredContent;
}

/** Runs a tool to its final card (the last snapshot of a streaming tool). */
export async function runTool(name: HakoToolName, rawInput: unknown, deps: AgentDeps): Promise<StructuredContent> {
  let last: StructuredContent | null = null;
  for await (const result of streamTool(name, rawInput, deps)) last = result;
  if (!last) throw invalidInput(`${name} returned no card`);
  return last;
}
