/**
 * The gateway's money routes (plan B13, L1), each typed by the endpoint table in @hako/cards (`GATEWAY_ENDPOINTS`):
 *   POST /v1/quote          one LI.FI route (fees, ETA, min received) + its rehearsal line when a draft is named
 *   POST /v1/routes         the route race, streamed as NDJSON snapshots
 *   POST /v1/bridge         the exact approve (R16), the R15-bound transfer, or the fresh quote for review
 *   GET  /v1/bridge/status  LI.FI status for a source transaction
 *   POST /v1/earn/deposit · /v1/earn/withdraw   LI.FI Composer moves, same R16 → R15 sequence
 * plus /v1/rehearse (rehearse.ts), /v1/broadcast (broadcast.ts) and the free read aliases (aliases.ts).
 * Nothing here holds a key or signs (R8): proposals go back to the caller, PayBox signs them.
 */
import { ROUTE_RACE_ROUTE_TIMEOUT_MS } from "@hako/config";
import {
  bridgeRequestSchema,
  bridgeStatusQuerySchema,
  bridgeStatusResponseSchema,
  earnMoveRequestSchema,
  GATEWAY_ENDPOINTS,
  quoteRequestSchema,
  routesRequestSchema,
} from "@hako/cards/contract";
import { lifiStatus } from "@hako/defi/server";
import { explorerTxUrl } from "@hako/networks";
import type { Context, Hono } from "hono";
import { stream } from "hono/streaming";
import type { z } from "zod";

import type { GatewayConfig } from "../config.js";
import { HTTP_NOT_FOUND } from "../constants.js";
import { registerReadAliases } from "./aliases.js";
import { registerBroadcast } from "./broadcast.js";
import { answer, badRequest, lifiFailure, MoneyRouteError, readBody, readQuery, viaLifi } from "./money/http.js";
import { LIFI_STATUS_WORDS, MONEY_WORDS, NDJSON_CONTENT_TYPE, NO_STORE } from "./money/money.config.js";
import { buildProposal, executableSource } from "./money/proposals.js";
import {
  cachedQuote,
  cardToken,
  contendersFor,
  type FreshQuote,
  knownNetwork,
  proposable,
  routeData,
  type RouteParams,
  routeParams,
  tokenFacts,
} from "./money/quotes.js";
import { raceRoutes, type RaceResult } from "./money/race.js";
import { lifi } from "./money/runtime.js";
import { registerRehearse, rehearsalOf } from "./rehearse.js";

const PATHS = {
  quote: GATEWAY_ENDPOINTS.quote.path,
  routes: GATEWAY_ENDPOINTS.routes.path,
  bridge: GATEWAY_ENDPOINTS.bridge.path,
  bridgeStatus: GATEWAY_ENDPOINTS.bridgeStatus.path,
  earnDeposit: GATEWAY_ENDPOINTS.earnDeposit.path,
  earnWithdraw: GATEWAY_ENDPOINTS.earnWithdraw.path,
} as const;

/**
 * When LI.FI's own pick can't become one PayBox proposal (a Solana route needing a second signer, a native fee on an
 * ERC-20 move), race the contenders inside one route's budget and take the best one that can.
 */
async function bestProposable(params: RouteParams, rejected: FreshQuote): Promise<FreshQuote | null> {
  const header = {
    fromToken: cardToken(rejected.step.action.fromToken, params.fromChain),
    toToken: cardToken(rejected.step.action.toToken, params.toChain),
  };
  const result: RaceResult = { quotes: new Map() };
  const tools = contendersFor(params.fromChain, params.toChain).filter((tool) => tool !== rejected.quote.tool);
  for await (const snapshot of raceRoutes(params, tools, header, { totalMs: ROUTE_RACE_ROUTE_TIMEOUT_MS, result })) {
    if (snapshot.done && snapshot.winner) return result.quotes.get(snapshot.winner) ?? null;
  }
  return null;
}

async function quote(c: Context) {
  const body = await readBody(c, quoteRequestSchema);
  const params = routeParams(body);
  let fresh = await cachedQuote(params);
  const check = proposable(params, fresh.quote);
  if (!check.ok) {
    if (params.tool) throw badRequest("not_single_transaction", check.reason, [`POST ${PATHS.routes} to race other routes`]);
    const better = await bestProposable(params, fresh);
    if (!better) throw new MoneyRouteError(HTTP_NOT_FOUND, "no_route", MONEY_WORDS.noSingleTx, [check.reason]);
    fresh = better;
  }
  const rehearsal = body.draft ? await rehearsalOf(fresh.quote, body.draft) : null;
  return c.json(routeData(fresh, rehearsal));
}

async function routes(c: Context) {
  const body = await readBody(c, routesRequestSchema);
  const params = routeParams(body);
  const tools = [...new Set(body.tools ?? contendersFor(params.fromChain, params.toChain))];
  // Token lookups fail before the stream starts, so a bad token is an ordinary JSON error.
  const [fromToken, toToken] = await Promise.all([tokenFacts(params.fromChain, params.fromToken), tokenFacts(params.toChain, params.toToken)]);
  const closed = new AbortController();
  c.header("content-type", NDJSON_CONTENT_TYPE);
  c.header("cache-control", NO_STORE);
  return stream(
    c,
    async (out) => {
      out.onAbort(() => closed.abort());
      for await (const snapshot of raceRoutes(params, tools, { fromToken, toToken }, { signal: closed.signal })) {
        await out.write(`${JSON.stringify(snapshot)}\n`);
      }
    },
    async (error) => console.error(JSON.stringify({ event: "route_race_failed", error: String(error) })),
  );
}

async function bridge(c: Context) {
  const body = await readBody(c, bridgeRequestSchema);
  return c.json(await buildProposal(routeParams(body), body.tool, body.minReceivedAtomic));
}

type BridgeStatus = z.output<typeof bridgeStatusResponseSchema>;

async function bridgeStatus(c: Context) {
  const query = readQuery(c, bridgeStatusQuerySchema);
  const from = knownNetwork(query.fromChain);
  const to = query.toChain ? knownNetwork(query.toChain) : null;
  let status;
  try {
    status = await viaLifi(lifiStatus(lifi(), { txHash: query.txHash, tool: query.tool, fromChain: from.caip2, toChain: to?.caip2 }));
  } catch (error) {
    // LI.FI answers 404 for a hash it has never seen: that is a status, not a failure.
    if (lifiFailure(error).code !== "no_route") throw error;
    status = null;
  }
  const sendingHash = status?.sendingTxHash ?? query.txHash;
  const receivingNetwork = (status?.receivingChain ? knownNetwork(status.receivingChain) : null) ?? to;
  const receivingHash = status?.receivingTxHash ?? null;
  const body: BridgeStatus = {
    status: status ? LIFI_STATUS_WORDS[status.status] : "not_found",
    substatus: status?.substatus ?? null,
    substatusMessage: status?.message ?? null,
    tool: status?.tool ?? query.tool ?? null,
    sending: { chain: from.caip2, txHash: sendingHash, amountAtomic: null, token: null, explorerUrl: explorerTxUrl(from, sendingHash) },
    receiving: receivingNetwork
      ? {
          chain: receivingNetwork.caip2,
          txHash: receivingHash,
          amountAtomic: status?.receivedAmountAtomic ?? null,
          token: null,
          explorerUrl: receivingHash ? explorerTxUrl(receivingNetwork, receivingHash) : null,
        }
      : null,
  };
  return c.json(bridgeStatusResponseSchema.parse(body));
}

/** Earn (EVM, LI.FI Composer): a deposit spends the token for vault shares, a withdraw spends the shares. */
function earnMove(direction: "deposit" | "withdraw") {
  return async (c: Context) => {
    const body = await readBody(c, earnMoveRequestSchema);
    const network = executableSource(body.chain);
    if (network.family !== "evm") throw badRequest("chain_not_executable", "LI.FI Earn moves run on EVM chains only.");
    const deposit = direction === "deposit";
    const params = routeParams({
      fromChain: network.caip2,
      toChain: network.caip2,
      fromToken: deposit ? body.token : body.vault,
      toToken: deposit ? body.vault : body.token,
      fromAmountAtomic: body.amountAtomic,
      fromAddress: body.fromAddress,
      toAddress: body.fromAddress,
      tool: body.tool,
    });
    return c.json(await buildProposal(params, body.tool, body.minReceivedAtomic));
  };
}

export function registerMoneyRoutes(app: Hono, config: GatewayConfig): void {
  app.post(PATHS.quote, (c) => answer(c, () => quote(c)));
  app.post(PATHS.routes, (c) => answer(c, () => routes(c)));
  app.post(PATHS.bridge, (c) => answer(c, () => bridge(c)));
  app.get(PATHS.bridgeStatus, (c) => answer(c, () => bridgeStatus(c)));
  app.post(PATHS.earnDeposit, (c) => answer(c, earnMove("deposit").bind(null, c)));
  app.post(PATHS.earnWithdraw, (c) => answer(c, earnMove("withdraw").bind(null, c)));
  registerRehearse(app);
  registerBroadcast(app);
  registerReadAliases(app, config);
}
