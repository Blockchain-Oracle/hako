/**
 * Money proposals (plan §1 A6 and A8): whatever the gateway's `/v1/bridge` or `/v1/earn/*` answers, the plugin checks
 * it again with R15 and R16 from @hako/defi/core, fails closed, and only then wraps it as `io.paybox/transactionProposal`
 * with the starter's helpers: one EVM call, or one Solana transaction of at most 1,232 bytes with one signer.
 * - approve (R16): the exact-amount approve to an allowlisted LI.FI spender, rebuilt here, "Step 1 of 2";
 * - transfer (R15): the fresh quote bound to the reviewed route, its transaction proposed as LI.FI built it;
 * - review: a lower minimum received goes back to the person instead of becoming a proposal.
 */
import * as z from "zod/v4";

import { PROPOSAL_TTL_S, QUOTE_MIN_REMAINING_S } from "./constants.js";
import { HakoError } from "./errors.js";
import { evmOutputSchema, proposeEvm, proposeSolana, solanaOutputSchema } from "./paybox.js";
import {
  bindQuote,
  canonicalCaip2,
  erc20ApproveCalldata,
  fromAtomic,
  isExecutableCaip2,
  LIFI_CONTRACT_ALLOWLIST,
  MS_PER_SECOND,
  networkByCaip2,
  type NormalizedQuote,
  parseAtomic,
  type R15Rules,
  type R16Rules,
  type ReviewedRoute,
  sameAddress,
  SOLANA_TX_MAX_BYTES,
  SOLANA_TX_REQUIRED_SIGNERS,
  ZERO_UNITS,
} from "./shared.js";
import type { ProposalResponse, RouteData } from "./wire/money.js";

const PROPOSAL_KEY = "io.paybox/transactionProposal";

/** A money tool's output: exactly one proposal, an EVM call or a Solana transaction, declared inline (PayBox's rule). */
export const moveOutputSchema = z
  .object({ [PROPOSAL_KEY]: z.union([evmOutputSchema.shape[PROPOSAL_KEY], solanaOutputSchema.shape[PROPOSAL_KEY]]) })
  .strict();
/** EVM-only moves (LI.FI Earn). */
export const evmMoveOutputSchema = evmOutputSchema;

/**
 * R15's rules for a source chain, filled from the one source of each value. Same composition as
 * packages/defi/src/server/rules.ts `r15RulesFor`, which the plugin can't import (it uses bare `@hako/*` imports).
 */
export function r15RulesFor(fromChain: string): R15Rules | null {
  const network = networkByCaip2(fromChain);
  if (!network) return null;
  return {
    allowedTargets: network.family === "evm" ? LIFI_CONTRACT_ALLOWLIST[network.key] : [],
    nativeToken: network.native.address,
    solanaMaxBytes: SOLANA_TX_MAX_BYTES,
    solanaRequiredSigners: SOLANA_TX_REQUIRED_SIGNERS,
    sameAddress,
    parseAtomic,
  };
}

/** R16's rules for an EVM source chain (`r16RulesFor` in packages/defi/src/server/rules.ts); null otherwise. */
export function r16RulesFor(chain: string): R16Rules | null {
  const network = networkByCaip2(chain);
  if (!network || network.family !== "evm") return null;
  return { allowedSpenders: LIFI_CONTRACT_ALLOWLIST[network.key], sameAddress, parseAtomic };
}

/** R17: a money tool signs only on an executable source chain (Base, Solana); the canonical CAIP-2 id when it is one. */
export function executableChain(chain: string): `${string}:${string}` {
  const canonical = canonicalCaip2(chain);
  if (!canonical || !isExecutableCaip2(canonical)) {
    const name = networkByCaip2(chain)?.name ?? chain;
    throw new HakoError("chain_not_executable", `Hako signs moves from Base and Solana only; ${name} stays quotable and readable.`);
  }
  return canonical;
}

/** Whole-second UTC expiry: four minutes, or sooner when the quote expires sooner; refused when too close to use. */
export function proposalExpiry(upstreamExpiresAt: string | null, now = Date.now()): string {
  let at = now + PROPOSAL_TTL_S * MS_PER_SECOND;
  if (upstreamExpiresAt !== null) {
    const upstream = Date.parse(upstreamExpiresAt);
    if (!Number.isFinite(upstream)) throw new HakoError("gateway_contract_mismatch", "The quote's expiry could not be read.");
    at = Math.min(at, upstream);
  }
  if (at - now < QUOTE_MIN_REMAINING_S * MS_PER_SECOND) {
    throw new HakoError("quote_expired", "The quote expires before it could be approved and signed; ask for a fresh one.");
  }
  return new Date(Math.floor(at / MS_PER_SECOND) * MS_PER_SECOND).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "1.5 USDC" from atomic units, never through a float. */
export function amountText(atomic: string, decimals: number, symbol: string): string {
  return `${fromAtomic(parseAtomic(atomic), decimals)} ${symbol}`;
}

type Approve = Extract<ProposalResponse, { step: "approve" }>;
type Transfer = Extract<ProposalResponse, { step: "transfer" }>;

const refuseR15 = (message: string) => new HakoError("r15_refused", message);
const refuseR16 = (message: string) => new HakoError("r16_refused", message);

/** The gateway's route and transaction as @hako/defi's normalised quote, so R15 reads exactly what will be signed. */
export function normalizedQuote(route: RouteData, tx: Transfer["tx"]): NormalizedQuote {
  const from = networkByCaip2(route.fromChain);
  const to = networkByCaip2(route.toChain);
  if (!from || !to) throw refuseR15("The quote uses a chain Hako can't execute on.");
  const token = (ref: RouteData["fromToken"]) => ({ address: ref.address, symbol: ref.symbol, decimals: ref.decimals, priceUsd: null, logoUri: ref.logoUrl ?? null });
  return {
    // The gateway's route carries no LI.FI step id; R15 doesn't read one.
    id: "",
    tool: route.tool,
    toolName: route.toolName,
    toolLogoUri: route.toolLogoUrl,
    fromChainId: from.lifiChainId,
    toChainId: to.lifiChainId,
    fromChain: from.caip2,
    toChain: to.caip2,
    fromToken: token(route.fromToken),
    toToken: token(route.toToken),
    fromAddress: route.fromAddress,
    toAddress: route.toAddress,
    fromAmountAtomic: route.fromAmountAtomic,
    toAmountAtomic: route.toAmountAtomic,
    toAmountMinAtomic: route.toAmountMinAtomic,
    feeUsd: route.feeUsd,
    gasUsd: route.gasUsd,
    estimatedDurationS: route.estimatedDurationS,
    approvalAddress: route.approvalAddress,
    transaction:
      "transactionBase64" in tx
        ? { family: "solana", transactionBase64: tx.transactionBase64 }
        : { family: "evm", chainId: tx.chainId, to: tx.to, from: null, data: tx.data, value: tx.value, gasLimit: tx.gas ?? null },
    quotedAt: route.quotedAt,
    expiresAt: route.expiresAt,
  };
}

/** The new quote in words, for the person to review (R15's lower-minimum case). */
function reviewError(reviewed: ReviewedRoute, route: RouteData, toolName: string, reason: string): HakoError {
  const { decimals, symbol } = route.toToken;
  return new HakoError(
    "quote_needs_review",
    `${reason} The fresh ${route.toolName} quote now guarantees at least ${amountText(route.toAmountMinAtomic, decimals, symbol)} ` +
      `(you reviewed ${amountText(reviewed.toAmountMinAtomic, decimals, symbol)}). Show the person this quote; if they accept it, ` +
      `call ${toolName} again with the same input and minReceivedAtomic "${route.toAmountMinAtomic}" (tool "${route.tool}").`,
  );
}

/** R16: rebuilds the exact-amount approve and checks the gateway's call equals it, failing closed. */
export function proposeApproveStep(reviewed: ReviewedRoute, step: Approve, toolName: string) {
  const rules = r16RulesFor(reviewed.fromChain);
  const network = networkByCaip2(reviewed.fromChain);
  if (!rules || !network || network.family !== "evm") throw refuseR16("Only EVM moves have an approve step.");
  if (canonicalCaip2(step.chain) !== network.caip2) throw refuseR16("The approve is for a different chain than the move.");
  if (sameAddress(reviewed.fromToken, network.native.address)) throw refuseR16(`${network.native.symbol} needs no approve.`);
  if (!sameAddress(step.token.address, reviewed.fromToken)) throw refuseR16("The approve names a different token than the move.");
  const amount = parseAtomic(reviewed.fromAmountAtomic);
  if (parseAtomic(step.amountAtomic) !== amount) throw refuseR16("The approve is not for exactly the amount being moved.");
  if (!rules.allowedSpenders.some((allowed) => rules.sameAddress(allowed, step.spender))) {
    throw refuseR16("The spender is not on LI.FI's contract allowlist for this chain.");
  }
  const data = erc20ApproveCalldata(step.spender, amount);
  const tx = step.tx;
  const sameCall =
    tx.chainId === network.chainId && sameAddress(tx.to, reviewed.fromToken) && parseAtomic(tx.value) === ZERO_UNITS && tx.data.toLowerCase() === data;
  if (!sameCall) throw refuseR16("The gateway's approve call is not the exact approve Hako builds.");
  const proposal = proposeEvm({ chain: network.caip2, to: tx.to, value: "0", data, expiresAt: proposalExpiry(null) });
  const text =
    `Step 1 of 2: approve exactly ${amountText(step.amountAtomic, step.token.decimals, step.token.symbol)} for LI.FI ` +
    `(${step.spender}) on ${network.name}. When this request reaches success, call ${toolName} again with the same input. ` +
    "Nothing is signed until the person approves in PayBox.";
  return { ...proposal, content: [{ type: "text" as const, text }] };
}

/** R15: binds the fresh quote to the reviewed route and proposes its one transaction, or says why it can't. */
export function proposeTransferStep(reviewed: ReviewedRoute, step: Transfer, toolName: string, verb: string) {
  const rules = r15RulesFor(reviewed.fromChain);
  if (!rules) throw refuseR15("The move's source chain is not one Hako knows.");
  if (parseAtomic(reviewed.toAmountMinAtomic) === ZERO_UNITS) {
    throw reviewError(reviewed, step.route, toolName, "No minimum received was reviewed yet, so this quote goes to the person first.");
  }
  const bound = bindQuote(reviewed, normalizedQuote(step.route, step.tx), rules);
  if (bound.status === "refused") throw refuseR15(`${bound.message} (${bound.reason})`);
  if (bound.status === "review") throw reviewError(reviewed, step.route, toolName, bound.message);
  const expiresAt = proposalExpiry(step.route.expiresAt);
  const proposal =
    bound.proposal.kind === "evm"
      ? proposeEvm({ chain: bound.proposal.chain, to: bound.proposal.to, value: bound.proposal.value, data: bound.proposal.data, expiresAt })
      : proposeSolana({ transactionBase64: bound.proposal.transactionBase64, expiresAt });
  const route = step.route;
  const text =
    `${verb} ${amountText(route.fromAmountAtomic, route.fromToken.decimals, route.fromToken.symbol)} on ${chainName(route.fromChain)} → ` +
    `at least ${amountText(route.toAmountMinAtomic, route.toToken.decimals, route.toToken.symbol)} on ${chainName(route.toChain)} ` +
    `via ${route.toolName}${route.feeUsd ? `, fees about $${route.feeUsd}` : ""}${route.estimatedDurationS !== null ? `, about ${route.estimatedDurationS} s` : ""}. ` +
    `Bound to the reviewed route (R15). Expires ${expiresAt}. Approve in PayBox, then follow the request id with get_request; never re-run ${toolName} to finish it.`;
  return { ...proposal, content: [{ type: "text" as const, text }] };
}

const chainName = (caip2: string) => networkByCaip2(caip2)?.name ?? caip2;

/** The gateway's answer for a reviewed move, checked and wrapped: the approve, the transfer, or the quote to review. */
export function proposeMove(reviewed: ReviewedRoute, response: ProposalResponse, toolName: string, verb: string) {
  if (response.step === "approve") return proposeApproveStep(reviewed, response, toolName);
  if (response.step === "transfer") return proposeTransferStep(reviewed, response, toolName, verb);
  throw reviewError(reviewed, response.route, toolName, response.reason);
}
