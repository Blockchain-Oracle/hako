import "server-only";

import { type Tool, tool, type ToolSet } from "ai";

import { compactInput, endpointById } from "@/lib/agent/catalog-view.server";
import {
  FindToolsInput,
  InspectToolInput,
  type RunOutput,
  RunOutputSchema,
  type RunProposal,
  RunToolInput,
} from "@/lib/agent/schemas";
import { MAX_TOOL_CALLS_PER_TURN } from "@/lib/constants/agent";
import { PAYMENT_NETWORK } from "@/lib/constants/onchain";
import { serverEnv } from "@/lib/server/env.server";

/** What `toModelOutput` returns (@ai-sdk/provider-utils `ToolResultOutput`, reached through the Tool type). */
type ToolResultOutput = Awaited<ReturnType<NonNullable<Tool["toModelOutput"]>>>;

const READ_TIMEOUT_MS = 6_000;
const BUDGET_SPENT = "This turn's tool budget is spent: nothing was run. Answer now from the results you have.";

/**
 * The model reads only what it must report: the proposal ran nothing and cost nothing, what the run would cost, and
 * that it needs the user's PayBox wallet. The pay card shows the same facts to the user.
 */
export function runForModel(output: RunOutput): ToolResultOutput {
  if ("trimmed" in output) return { type: "text", value: "(older result trimmed)" };
  switch (output.reason) {
    case "turn_budget_spent":
      return { type: "text", value: BUDGET_SPENT };
    case "unknown_tool":
      return { type: "text", value: `not run: no tool ${output.id}; call find_tools first.` };
    case "paybox_not_connected":
      return {
        type: "text",
        value:
          `not run, not charged: ${output.id} costs $${output.priceUsd ?? "?"} per call in USDC on ` +
          `${PAYMENT_NETWORK.label}, paid from the user's PayBox wallet, and PayBox is not connected to this chat. ` +
          "Every paid run needs it, so do not retry or try another paid tool. Tell the user the tool and its price, " +
          "and answer what you can without it.",
      };
  }
}

async function readJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${serverEnv().HAKO_API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  return res.json();
}

/** This turn's tool executions. Past the budget a tool answers at once without running: nothing is called or paid. */
function turnBudget(): () => boolean {
  let used = 0;
  return () => {
    used += 1;
    return used > MAX_TOOL_CALLS_PER_TURN;
  };
}

const findTools = (overBudget: () => boolean) => tool({
  description:
    "Search Hako's tool catalog for the job (free). Returns ranked tools with id, price, health and each tool's " +
    "input fields and an example, so you can usually run the best one directly.",
  inputSchema: FindToolsInput,
  execute: async ({ query, limit }) => {
    if (overBudget()) return { candidates: [], hints: [BUDGET_SPENT] };
    const found = (await readJson("/v1/discover", { query, limit })) as {
      candidates?: Array<{ id: string; summary: string; price: { usd: string }; health?: { status: string; p50Ms: number | null } }>;
      hints?: string[];
    };
    const candidates = await Promise.all(
      (found.candidates ?? []).map(async (c) => {
        const endpoint = await endpointById(c.id);
        return {
          id: c.id,
          summary: c.summary,
          price_usd: c.price.usd,
          health: c.health ? `${c.health.status}${c.health.p50Ms ? ` ${c.health.p50Ms}ms` : ""}` : "unknown",
          input: endpoint ? compactInput(endpoint) : {},
          example: endpoint?.example,
        };
      }),
    );
    return { candidates, hints: found.hints ?? [] };
  },
});

const inspectTool = (overBudget: () => boolean) => tool({
  description: "Read one tool's full contract (free): what it does and will not do, its input fields and an example.",
  inputSchema: InspectToolInput,
  execute: async ({ id }) => {
    if (overBudget()) return { error: BUDGET_SPENT };
    const endpoint = await endpointById(id);
    if (!endpoint) return { error: `no tool ${id}; call find_tools` };
    return {
      id,
      description: endpoint.description,
      notes: endpoint.notes,
      price_usd: endpoint.price.usd,
      input: compactInput(endpoint),
      example: endpoint.example,
    };
  },
});

/**
 * run_tool proposes a paid run and runs nothing: Hako holds no wallet and never pays on anyone's behalf, and paid
 * runs are paid from the user's PayBox wallet, which this chat cannot connect yet (Connect PayBox comes later). The
 * browser shows the proposal as a pay card with the tool and its exact price.
 */
const runTool = (overBudget: () => boolean) => tool({
  description:
    "Propose a paid run of one tool with its input (use the id and input fields from find_tools). Paid runs are " +
    "paid per call in USDC from the user's PayBox wallet, which is not connected here: the user sees the tool and " +
    "its exact price, and nothing is run or charged.",
  inputSchema: RunToolInput,
  outputSchema: RunOutputSchema,
  execute: async ({ id }): Promise<RunProposal> => {
    if (overBudget()) return { id, ran: false, reason: "turn_budget_spent" };
    const endpoint = await endpointById(id);
    if (!endpoint) return { id, ran: false, reason: "unknown_tool" };
    return { id, ran: false, reason: "paybox_not_connected", priceUsd: endpoint.price.usd };
  },
  toModelOutput: ({ output }: { output: RunOutput }) => runForModel(output),
});

/** One set per turn: the budget counts this turn's executions. */
export function buildTools() {
  const overBudget = turnBudget();
  return {
    find_tools: findTools(overBudget),
    inspect_tool: inspectTool(overBudget),
    run_tool: runTool(overBudget),
  } satisfies ToolSet;
}

export type HakoTools = ReturnType<typeof buildTools>;
