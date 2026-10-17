/**
 * `POST /v1/rehearse` (plan B13, free): simulate one draft version before anyone signs it, cached by `id:version`.
 *   EVM: one `eth_simulateV1` (viem `simulateCalls`) of the approve and the transfer together, from the user's address,
 *        on the public RPCs of the executable chains (@hako/networks);
 *   Solana: `simulateTransaction` on Helius (HELIUS_API_KEY), then Solana's public RPCs when Helius can't answer.
 * The budget is REHEARSAL_TIMEOUT_MS: over it the answer is `skipped` with a reason (never cached, so the next ask can
 * pass). A chain that can't simulate is `unsupported` ("Not rehearsed on <chain>"), never a pass.
 */
import { createHash } from "node:crypto";

import { REHEARSAL_TIMEOUT_MS } from "@hako/config";
import { GATEWAY_ENDPOINTS, type RehearsalData, rehearseRequestSchema } from "@hako/cards/contract";
import { erc20ApproveCalldata, type NormalizedQuote } from "@hako/defi/server";
import { isExecutableCaip2, networkByCaip2 } from "@hako/networks";
import type { Hono } from "hono";
import type { Address, Hex } from "viem";
import type { z } from "zod";

import { revertWords, type SimulationOutcome, simulateEvmCalls } from "./money/evm.js";
import { answer, badRequest, MoneyRouteError, readBody } from "./money/http.js";
import { MONEY_WORDS, REHEARSAL_CACHE_TTL_S } from "./money/money.config.js";
import { store } from "./money/runtime.js";
import { simulateSolana } from "./money/solana.js";

export type RehearseRequest = z.output<typeof rehearseRequestSchema>;

const OVER_BUDGET = Symbol("over budget");

/** `work`, or OVER_BUDGET once REHEARSAL_TIMEOUT_MS has passed (the simulation's own RPC timeout ends it soon after). */
async function withinBudget<T>(work: Promise<T>): Promise<T | typeof OVER_BUDGET> {
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<typeof OVER_BUDGET>((resolve) => {
    timer = setTimeout(() => resolve(OVER_BUDGET), REHEARSAL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, budget]);
  } finally {
    clearTimeout(timer);
  }
}

async function simulate(request: RehearseRequest): Promise<SimulationOutcome | { unsupported: string }> {
  const network = networkByCaip2(request.chain);
  const chainName = network?.name ?? request.chain;
  if (!network || !isExecutableCaip2(network.caip2)) return { unsupported: MONEY_WORDS.notRehearsed(chainName) };
  if ("calls" in request) {
    if (network.family !== "evm") throw badRequest("invalid_request", `${chainName} is not an EVM chain; send transactionBase64.`);
    const calls = request.calls.map((call) => ({ to: call.to as Address, data: call.data as Hex, value: BigInt(call.value) }));
    return simulateEvmCalls(network, request.from as Address, calls, REHEARSAL_TIMEOUT_MS);
  }
  if (network.family !== "solana") throw badRequest("invalid_request", `${chainName} is an EVM chain; send calls.`);
  return simulateSolana(request.transactionBase64, false, REHEARSAL_TIMEOUT_MS);
}

/** Rehearses one draft version (cached per `id:version` and request, so a different body never reads another's result). */
export async function rehearse(request: RehearseRequest): Promise<RehearsalData> {
  const key = `${request.draftId}:${request.version}` as const;
  const cacheKey = `rehearsal:${key}:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`;
  const hit = await store().get<RehearsalData>(cacheKey);
  if (hit) return hit;
  const chain = networkByCaip2(request.chain)?.caip2 ?? request.chain;

  let outcome: Awaited<ReturnType<typeof simulate>> | typeof OVER_BUDGET;
  try {
    outcome = await withinBudget(simulate(request));
  } catch (error) {
    if (error instanceof MoneyRouteError) throw error;
    // The RPC failed (no eth_simulateV1, unreachable): this version is simply not rehearsed right now.
    return { status: "skipped", key, chain, reason: `${MONEY_WORDS.notRehearsed(networkByCaip2(chain)?.name ?? chain)}: ${revertWords(error)}` };
  }
  if (outcome === OVER_BUDGET) return { status: "skipped", key, chain, reason: MONEY_WORDS.overBudget(REHEARSAL_TIMEOUT_MS) };

  const simulatedAt = new Date().toISOString();
  const result: RehearsalData =
    "unsupported" in outcome
      ? { status: "unsupported", key, chain, reason: outcome.unsupported }
      : outcome.ok
        ? { status: "passed", key, chain, simulatedAt }
        : { status: "failed", key, chain, reason: outcome.reason, simulatedAt };
  await store().set(cacheKey, result, REHEARSAL_CACHE_TTL_S);
  return result;
}

/**
 * A quote's rehearsal for a draft version (`/v1/quote` with `draft`): the exact approve (when LI.FI names a spender)
 * and the transfer together on EVM, the transaction itself on Solana.
 */
export function rehearsalOf(quote: NormalizedQuote, draft: { draftId: string; version: number }): Promise<RehearsalData> {
  const chain = quote.fromChain ?? `eip155:${quote.fromChainId}`;
  const tx = quote.transaction;
  if (tx?.family === "solana") return rehearse({ ...draft, chain: chain as RehearseRequest["chain"], from: quote.fromAddress, transactionBase64: tx.transactionBase64 });
  const transfer = tx ? [{ to: tx.to, data: tx.data, value: tx.value }] : [];
  const approve = quote.approvalAddress
    ? [{ to: quote.fromToken.address, data: erc20ApproveCalldata(quote.approvalAddress, BigInt(quote.fromAmountAtomic)), value: "0" }]
    : [];
  const calls = [...approve, ...transfer];
  if (calls.length === 0 || !tx) {
    return Promise.resolve({ status: "unsupported", key: `${draft.draftId}:${draft.version}`, chain: chain as RehearsalData["chain"], reason: "The quote carries no transaction to rehearse." });
  }
  return rehearse({ ...draft, chain: chain as RehearseRequest["chain"], from: quote.fromAddress, calls });
}

export function registerRehearse(app: Hono): void {
  app.post(GATEWAY_ENDPOINTS.rehearse.path, (c) => answer(c, async () => c.json(await rehearse(await readBody(c, rehearseRequestSchema)))));
}
