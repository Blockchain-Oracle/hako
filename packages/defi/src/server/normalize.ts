import { MS_PER_SECOND, QUOTE_CACHE_TTL_S } from "@hako/config";
import { fromAtomic, sameAddress, sumAtomic, toAtomic } from "@hako/money";
import { networkByLifiChainId } from "@hako/networks";
import type { LiFiStep, Token, TransactionRequest } from "@lifi/types";

import type { NormalizedQuote, QuoteTransaction, TokenRef } from "../core/index.ts";
import { FEE_USD_DECIMALS } from "./defi.config.ts";

/** A LI.FI token as Hako's quote names it. */
export function tokenRef(token: Token): TokenRef {
  return {
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    priceUsd: token.priceUSD || null,
    logoUri: token.logoURI ?? null,
  };
}

/** The CAIP-2 id of a LI.FI chain when Hako's registry knows it, else null. */
export function caip2ForLifiChain(lifiChainId: number): string | null {
  return networkByLifiChainId(lifiChainId)?.caip2 ?? null;
}

/** A LI.FI amount (decimal or 0x-hex string) as a base-10 integer string. */
export function decimalString(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  return BigInt(value).toString();
}

/** Sums USD decimal strings exactly (truncated to FEE_USD_DECIMALS); null when there is nothing to sum. */
export function sumUsd(values: readonly (string | undefined)[]): string | null {
  const present = values.filter((value): value is string => typeof value === "string" && value.trim() !== "");
  if (present.length === 0) return null;
  const atomic = present.map((value) => {
    const [whole = "0", fraction = ""] = value.trim().split(".");
    return toAtomic(`${whole}.${fraction.slice(0, FEE_USD_DECIMALS) || "0"}`, FEE_USD_DECIMALS);
  });
  return fromAtomic(sumAtomic(atomic), FEE_USD_DECIMALS);
}

function transactionOf(step: LiFiStep): QuoteTransaction | null {
  const tx: TransactionRequest | undefined = step.transactionRequest;
  if (!tx?.data) return null;
  const family = networkByLifiChainId(step.action.fromChainId)?.family ?? (tx.to ? "evm" : "solana");
  if (family === "solana") return { family: "solana", transactionBase64: tx.data };
  if (!tx.to) return null;
  return {
    family: "evm",
    chainId: tx.chainId ?? step.action.fromChainId,
    to: tx.to,
    from: tx.from ?? null,
    data: tx.data,
    value: decimalString(tx.value) ?? "0",
    gasLimit: decimalString(tx.gasLimit),
  };
}

/** An approve comes first only for an ERC-20 on an EVM chain (a native coin is sent as value; Solana has none). */
function needsApproval(step: LiFiStep): boolean {
  const network = networkByLifiChainId(step.action.fromChainId);
  if (network?.family === "solana") return false;
  return !(network && sameAddress(step.action.fromToken.address, network.native.address));
}

/**
 * One LI.FI `/quote` step as Hako's `NormalizedQuote`. A quote is fresh for QUOTE_CACHE_TTL_S: after that the card
 * re-quotes, and execution always binds a fresh quote with R15 anyway.
 */
export function normalizeLifiStep(step: LiFiStep, quotedAt: Date = new Date()): NormalizedQuote {
  const estimate = step.estimate;
  if (!estimate) throw new Error(`LI.FI returned step ${step.id} without an estimate.`);
  const action = step.action;
  const gasUsd = sumUsd((estimate.gasCosts ?? []).map((cost) => cost.amountUSD));
  const feeUsd = sumUsd([...(estimate.feeCosts ?? []).map((cost) => cost.amountUSD), gasUsd ?? undefined]);
  return {
    id: step.id,
    tool: step.tool,
    toolName: step.toolDetails?.name ?? null,
    toolLogoUri: step.toolDetails?.logoURI ?? null,
    fromChainId: action.fromChainId,
    toChainId: action.toChainId,
    fromChain: caip2ForLifiChain(action.fromChainId),
    toChain: caip2ForLifiChain(action.toChainId),
    fromToken: tokenRef(action.fromToken),
    toToken: tokenRef(action.toToken),
    fromAddress: action.fromAddress ?? "",
    toAddress: action.toAddress ?? action.fromAddress ?? "",
    fromAmountAtomic: estimate.fromAmount || action.fromAmount,
    toAmountAtomic: estimate.toAmount,
    toAmountMinAtomic: estimate.toAmountMin,
    feeUsd,
    gasUsd,
    estimatedDurationS: Number.isFinite(estimate.executionDuration) ? estimate.executionDuration : null,
    approvalAddress: needsApproval(step) ? estimate.approvalAddress || null : null,
    transaction: transactionOf(step),
    quotedAt: quotedAt.toISOString(),
    expiresAt: new Date(quotedAt.getTime() + QUOTE_CACHE_TTL_S * MS_PER_SECOND).toISOString(),
  };
}
