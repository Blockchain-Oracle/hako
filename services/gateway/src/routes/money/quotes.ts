/**
 * LI.FI quotes for the money routes: one `/quote` step (cached QUOTE_CACHE_TTL_S by request hash for reads, always
 * fresh for proposals), the "can this ever become one PayBox proposal" check (R15 on the quote's own tool and floor),
 * and the step as the cards contract's `route` (RouteData). The raw step is kept beside @hako/defi's NormalizedQuote
 * because the route card's fee lines, USD amounts and R16's `approvalReset` live only in it.
 */
import { createHash } from "node:crypto";

import { QUOTE_CACHE_TTL_S } from "@hako/config";
import { type RehearsalData, type RouteData, routeDataSchema, type TokenRef as CardToken, urlSchema, usdSchema } from "@hako/cards/contract";
import {
  bindQuote,
  type CallOptions,
  callSignal,
  caip2ForLifiChain,
  decimalString,
  lifiToken,
  type NormalizedQuote,
  normalizeLifiStep,
  quoteRequest,
  r15RulesFor,
  type ReviewedRoute,
} from "@hako/defi/server";
import { type Caip2, type Network, NETWORK_KEYS, networkByCaip2, NETWORKS } from "@hako/networks";
import { getQuote, getTools } from "@lifi/sdk";
import type { LiFiStep, Token } from "@lifi/types";

import { badRequest, viaLifi } from "./http.js";
import {
  FEE_FALLBACK_NAME,
  GAS_FEE_NAME,
  LIFI_TOOLS_TTL_S,
  MONEY_WORDS,
  RACE_BRIDGES,
  RACE_EVM_EXCHANGES,
  RACE_SOLANA_EXCHANGES,
  SINGLE_TRANSACTION_STEPS,
  TOKEN_FACTS_TTL_S,
} from "./money.config.js";
import { cached, lifi } from "./runtime.js";

/** What every LI.FI quote is asked for (the contract's `routeRequestSchema`), chains in Hako's canonical CAIP-2. */
export interface RouteParams {
  fromChain: Caip2;
  toChain: Caip2;
  fromToken: string;
  toToken: string;
  fromAmountAtomic: string;
  fromAddress: string;
  toAddress: string;
  /** Pins `allowBridges=[tool]` (or `allowExchanges` on one chain). */
  tool?: string;
}

export interface FreshQuote {
  step: LiFiStep;
  quote: NormalizedQuote;
}

const CHAIN_NAMES = NETWORK_KEYS.map((key) => NETWORKS[key].name).join(", ");

/** The network for a chain id (aliases accepted), or 400: Hako quotes, moves and reads only its own registry's chains. */
export function knownNetwork(caip2: string): Network {
  const network = networkByCaip2(caip2);
  if (!network) throw badRequest("unsupported_chain", `Hako works on ${CHAIN_NAMES}; ${caip2 || "no chain"} isn't one of them.`);
  return network;
}

/** A request's route fields with both chains canonical, so R15 compares like with like. */
export function routeParams(body: Omit<RouteParams, "fromChain" | "toChain"> & { fromChain: string; toChain: string }): RouteParams {
  return {
    fromChain: knownNetwork(body.fromChain).caip2,
    toChain: knownNetwork(body.toChain).caip2,
    fromToken: body.fromToken,
    toToken: body.toToken,
    fromAmountAtomic: body.fromAmountAtomic,
    fromAddress: body.fromAddress,
    toAddress: body.toAddress,
    ...(body.tool ? { tool: body.tool } : {}),
  };
}

/** One LI.FI `/quote`, never cached: what a proposal is built and bound from. */
export async function freshQuote(params: RouteParams, options: CallOptions = {}): Promise<FreshQuote> {
  const step = await viaLifi(getQuote(lifi(), quoteRequest(params), { signal: callSignal(options) }));
  return { step, quote: normalizeLifiStep(step) };
}

const quoteKey = (params: RouteParams) => `quote:${createHash("sha256").update(JSON.stringify(quoteRequest(params))).digest("hex")}`;

/** A quote for reading (cards, the race): the same request inside QUOTE_CACHE_TTL_S answers from the cache. */
export const cachedQuote = (params: RouteParams, options: CallOptions = {}): Promise<FreshQuote> =>
  cached(quoteKey(params), QUOTE_CACHE_TTL_S, () => freshQuote(params, options));

/** The reviewed route R15 binds a fresh quote to: the request, the picked tool and the reviewed floor. */
export const reviewedRoute = (params: RouteParams, tool: string, toAmountMinAtomic: string): ReviewedRoute => ({
  fromChain: params.fromChain,
  toChain: params.toChain,
  fromToken: params.fromToken,
  toToken: params.toToken,
  fromAmountAtomic: params.fromAmountAtomic,
  fromAddress: params.fromAddress,
  toAddress: params.toAddress,
  tool,
  toAmountMinAtomic,
});

/**
 * Whether this quote could ever become one PayBox proposal: R15 run against the quote's own tokens, tool and floor,
 * so only the transaction's shape decides (one EVM call to LI.FI's allowlist without stray native value, or one Solana
 * transaction with exactly one signer, the sender). Race rows and `/v1/quote` drop what fails here.
 */
export function proposable(params: RouteParams, quote: NormalizedQuote): { ok: true } | { ok: false; reason: string } {
  const rules = r15RulesFor(params.fromChain);
  if (!rules) return { ok: false, reason: MONEY_WORDS.noSingleTx };
  const own = { ...params, fromToken: quote.fromToken.address, toToken: quote.toToken.address, fromAmountAtomic: quote.fromAmountAtomic };
  const result = bindQuote(reviewedRoute(own, quote.tool, quote.toAmountMinAtomic), quote, rules);
  if (result.status === "bound") return { ok: true };
  return { ok: false, reason: result.status === "refused" ? `${MONEY_WORDS.noSingleTx}: ${result.message}` : MONEY_WORDS.noSingleTx };
}

const optionalUrl = (value: string | null | undefined): string | null => (value && urlSchema.safeParse(value).success ? value : null);
const optionalUsd = (value: string | null | undefined): string | null => (value && usdSchema.safeParse(value).success ? value : null);

/** A LI.FI token as a card names it (the logo stays LI.FI's URL: cards draw it through the gateway's logo proxy). */
export function cardToken(token: Pick<Token, "address" | "symbol" | "decimals"> & { name?: string; logoURI?: string }, chain: Caip2): CardToken {
  const logoUrl = optionalUrl(token.logoURI);
  return {
    chain,
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    ...(token.name ? { name: token.name } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  };
}

/** LI.FI's fee costs and gas costs as the route card's fee lines (a line on a chain Hako can't name is left out). */
function feeLines(step: LiFiStep): RouteData["fees"] {
  const estimate = step.estimate;
  const lines = [
    ...(estimate.feeCosts ?? []).map((fee) => ({ name: fee.name, token: fee.token, amount: fee.amount, usd: fee.amountUSD, included: fee.included })),
    ...(estimate.gasCosts ?? []).map((gas) => ({ name: GAS_FEE_NAME, token: gas.token, amount: gas.amount, usd: gas.amountUSD, included: false })),
  ];
  return lines.flatMap((line) => {
    const chain = caip2ForLifiChain(line.token.chainId) as Caip2 | null;
    const amountAtomic = decimalString(line.amount);
    if (!chain || amountAtomic === null) return [];
    const amount = { token: cardToken(line.token, chain), amountAtomic, usd: optionalUsd(line.usd) };
    return [{ name: line.name.trim() || FEE_FALLBACK_NAME, amount, included: line.included }];
  });
}

/** The quote as the contract's `route` (checked against routeDataSchema, so drift fails here, not in a card). */
export function routeData({ step, quote }: FreshQuote, rehearsal: RehearsalData | null): RouteData {
  const fromChain = quote.fromChain as Caip2 | null;
  const toChain = quote.toChain as Caip2 | null;
  if (!fromChain || !toChain) throw badRequest("unsupported_chain", "LI.FI answered with a chain Hako can't execute on.");
  return routeDataSchema.parse({
    tool: quote.tool,
    toolName: quote.toolName ?? quote.tool,
    toolLogoUrl: optionalUrl(quote.toolLogoUri),
    fromAmountAtomic: quote.fromAmountAtomic,
    toAmountAtomic: quote.toAmountAtomic,
    toAmountMinAtomic: quote.toAmountMinAtomic,
    feeUsd: optionalUsd(quote.feeUsd),
    estimatedDurationS: quote.estimatedDurationS,
    approvalAddress: quote.approvalAddress,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
    fromChain,
    toChain,
    fromToken: cardToken(step.action.fromToken, fromChain),
    toToken: cardToken(step.action.toToken, toChain),
    fromAddress: quote.fromAddress,
    toAddress: quote.toAddress,
    fromAmountUsd: optionalUsd(step.estimate.fromAmountUSD),
    toAmountUsd: optionalUsd(step.estimate.toAmountUSD),
    gasUsd: optionalUsd(quote.gasUsd),
    fees: feeLines(step),
    steps: SINGLE_TRANSACTION_STEPS,
    rehearsal,
  });
}

/** A token's facts (symbol, decimals, logo) by address or symbol, for headers drawn before any quote answers. */
export const tokenFacts = (chain: Caip2, token: string): Promise<CardToken> =>
  cached(`token:${chain}:${token}`, TOKEN_FACTS_TTL_S, async () => {
    const found = await viaLifi(lifiToken(lifi(), chain, token));
    return cardToken({ address: found.address, symbol: found.symbol, decimals: found.decimals, logoURI: found.logoUri ?? undefined }, chain);
  });

export interface ToolFace {
  name: string;
  logoUrl: string | null;
}

/** LI.FI's bridges and exchanges by key (name and logo per race row); empty when LI.FI can't be reached right now. */
export async function toolFaces(): Promise<Record<string, ToolFace>> {
  try {
    return await cached("tools", LIFI_TOOLS_TTL_S, async () => {
      const tools = await getTools(lifi(), {}, { signal: callSignal() });
      const faces: Record<string, ToolFace> = {};
      for (const tool of [...tools.bridges, ...tools.exchanges]) faces[tool.key] = { name: tool.name, logoUrl: optionalUrl(tool.logoURI) };
      return faces;
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: "lifi_tools_unavailable", error: String(error) }));
    return {};
  }
}

/** The gateway's own contenders: bridges across chains, the chain family's exchanges on one chain. */
export function contendersFor(fromChain: Caip2, toChain: Caip2): readonly string[] {
  if (fromChain !== toChain) return RACE_BRIDGES;
  return knownNetwork(fromChain).family === "solana" ? RACE_SOLANA_EXCHANGES : RACE_EVM_EXCHANGES;
}
