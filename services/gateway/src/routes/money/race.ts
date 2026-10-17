/**
 * The route race (plan add-ons "Route race", B13 `/v1/routes`): one LI.FI `/quote` per contender, in parallel, pinned
 * with `allowBridges=[tool]` (`allowExchanges` on one chain), ROUTE_RACE_ROUTE_TIMEOUT_MS each and
 * ROUTE_RACE_TOTAL_TIMEOUT_MS in all. A snapshot goes out when the race starts and each time a row settles; the last one
 * is `done` and names the winner: the most received among rows that can become one PayBox proposal.
 */
import { randomUUID } from "node:crypto";

import { MS_PER_SECOND, ROUTE_RACE_ROUTE_TIMEOUT_MS, ROUTE_RACE_TOTAL_TIMEOUT_MS } from "@hako/config";
import type { RouteRaceData, TokenRef as CardToken } from "@hako/cards/contract";
import { isTimeout } from "@hako/defi/server";

import { lifiFailure } from "./http.js";
import { MONEY_WORDS } from "./money.config.js";
import { cachedQuote, type FreshQuote, proposable, type RouteParams, toolFaces } from "./quotes.js";

type Row = RouteRaceData["rows"][number];

export interface RaceHeader {
  fromToken: CardToken;
  toToken: CardToken;
}

/** A settled contender: its row, and the quote when it can become a proposal. */
interface Settled {
  index: number;
  row: Row;
  quote: FreshQuote | null;
}

const blankRow = (tool: string, name: string, logoUrl: string | null): Row => ({
  tool,
  toolName: name,
  logoUrl,
  status: "asking",
  toAmountAtomic: null,
  toAmountMinAtomic: null,
  feeUsd: null,
  estimatedDurationS: null,
  reason: null,
});

async function askOne(params: RouteParams, base: Row, index: number, signal: AbortSignal, startedAt: number): Promise<Settled> {
  try {
    const fresh = await cachedQuote({ ...params, tool: base.tool }, { signal, timeoutMs: ROUTE_RACE_ROUTE_TIMEOUT_MS });
    if (fresh.quote.tool !== base.tool) {
      return { index, row: { ...base, status: "failed", reason: `LI.FI answered through ${fresh.quote.tool} instead` }, quote: null };
    }
    const check = proposable(params, fresh.quote);
    if (!check.ok) return { index, row: { ...base, status: "failed", reason: check.reason }, quote: null };
    const { toAmountAtomic, toAmountMinAtomic, feeUsd, estimatedDurationS } = fresh.quote;
    return { index, row: { ...base, status: "answered", toAmountAtomic, toAmountMinAtomic, feeUsd, estimatedDurationS }, quote: fresh };
  } catch (error) {
    if (isTimeout(error)) {
      const seconds = Math.round((Date.now() - startedAt) / MS_PER_SECOND);
      return { index, row: { ...base, status: "timed_out", reason: MONEY_WORDS.noAnswer(seconds) }, quote: null };
    }
    return { index, row: { ...base, status: "failed", reason: lifiFailure(error).message }, quote: null };
  }
}

/** The answered row that receives the most (ties go to the lower fee); null while none has answered. */
function winnerOf(rows: readonly Row[]): string | null {
  let best: Row | null = null;
  for (const row of rows) {
    if (row.status !== "answered" || row.toAmountAtomic === null) continue;
    if (!best || BigInt(row.toAmountAtomic) > BigInt(best.toAmountAtomic!)) best = row;
    else if (BigInt(row.toAmountAtomic) === BigInt(best.toAmountAtomic!) && Number(row.feeUsd ?? Infinity) < Number(best.feeUsd ?? Infinity)) best = row;
  }
  return best?.tool ?? null;
}

/** Each answered row's quote by tool (what `/v1/quote` falls back to). */
export interface RaceResult {
  quotes: Map<string, FreshQuote>;
}

/**
 * Runs the race and yields a snapshot per change. `signal` is the caller's (a closed stream stops every quote); the
 * race's own budget aborts whatever is still asking at ROUTE_RACE_TOTAL_TIMEOUT_MS (or `totalMs`).
 */
export async function* raceRoutes(
  params: RouteParams,
  tools: readonly string[],
  header: RaceHeader,
  options: { signal?: AbortSignal; totalMs?: number; result?: RaceResult } = {},
): AsyncGenerator<RouteRaceData> {
  const faces = await toolFaces();
  const rows = tools.map((tool) => blankRow(tool, faces[tool]?.name ?? tool, faces[tool]?.logoUrl ?? null));
  const raceId = randomUUID();
  const snapshot = (done: boolean): RouteRaceData => ({
    raceId,
    fromChain: params.fromChain,
    toChain: params.toChain,
    fromToken: header.fromToken,
    toToken: header.toToken,
    fromAmountAtomic: params.fromAmountAtomic,
    asked: rows.length,
    answered: rows.filter((row) => row.status === "answered").length,
    done,
    rows: rows.map((row) => ({ ...row })),
    // The leader so far while the race runs, the winner once it is done.
    winner: winnerOf(rows),
  });

  yield snapshot(false);
  const startedAt = Date.now();
  const budget = AbortSignal.timeout(options.totalMs ?? ROUTE_RACE_TOTAL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, budget]) : budget;
  const pending = new Map(rows.map((row, index) => [index, askOne(params, row, index, signal, startedAt)] as const));
  while (pending.size > 0) {
    const settled = await Promise.race(pending.values());
    pending.delete(settled.index);
    rows[settled.index] = settled.row;
    if (settled.quote) options.result?.quotes.set(settled.row.tool, settled.quote);
    if (options.signal?.aborted) return;
    yield snapshot(pending.size === 0);
  }
}
