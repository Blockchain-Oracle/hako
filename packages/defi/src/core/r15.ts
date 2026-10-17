/**
 * R15, the binding check (plan §1 A, which overrides detail/02-rules.md): a fresh LI.FI quote becomes a PayBox
 * proposal only when chain, sender, recipient, from-token, from-amount, LI.FI tool and target equal the reviewed
 * values and `toAmountMin` is at least the reviewed one. A lower minimum goes back for review instead of becoming a
 * proposal. Solana: at most 1,232 bytes and exactly one signer, the sender. Anything else fails closed with a reason.
 *
 * Runs in the plugin on whatever the gateway returns, and in the gateway and CLI before any request is created.
 */
import { checkSolanaTransaction, type SolanaCheckReason } from "./solana.ts";
import type { AmountHelpers, NormalizedQuote, ReviewedRoute, TransactionProposal } from "./types.ts";
import { ZERO_UNITS } from "./wire.config.ts";

export interface R15Rules extends AmountHelpers {
  /** LI.FI's contract allowlist for the source chain (@hako/networks LIFI_CONTRACT_ALLOWLIST); empty refuses every EVM target. */
  allowedTargets: readonly string[];
  /** The source chain's native coin as LI.FI names it (@hako/networks `network.native.address`). */
  nativeToken: string;
  /** @hako/config SOLANA_TX_MAX_BYTES and SOLANA_TX_REQUIRED_SIGNERS. */
  solanaMaxBytes: number;
  solanaRequiredSigners: number;
}

export type R15RefusalReason =
  | "unsupported_chain"
  | "chain_mismatch"
  | "sender_mismatch"
  | "recipient_mismatch"
  | "from_token_mismatch"
  | "to_token_mismatch"
  | "from_amount_mismatch"
  | "tool_mismatch"
  | "malformed_amount"
  | "missing_transaction"
  | "tx_chain_mismatch"
  | "tx_sender_mismatch"
  | "target_not_allowed"
  | "value_mismatch"
  | SolanaCheckReason;

export type R15Result =
  | { status: "bound"; proposal: TransactionProposal; quote: NormalizedQuote }
  | { status: "review"; reason: "to_amount_min_lower"; message: string; quote: NormalizedQuote }
  | { status: "refused"; reason: R15RefusalReason; message: string };

const refuse = (reason: R15RefusalReason, message: string): R15Result => ({ status: "refused", reason, message });

const EIP155_CHAIN = /^eip155:(\d+)$/;

function parse(rules: AmountHelpers, value: string): bigint | null {
  try {
    return rules.parseAtomic(value);
  } catch {
    return null;
  }
}

/** Binds a fresh quote to the reviewed route, or says why it can't (see the module comment). */
export function bindQuote(reviewed: ReviewedRoute, quote: NormalizedQuote, rules: R15Rules): R15Result {
  const same = rules.sameAddress;
  if (quote.fromChain === null || quote.toChain === null) return refuse("unsupported_chain", "The quote uses a chain Hako can't execute on.");
  if (quote.fromChain !== reviewed.fromChain || quote.toChain !== reviewed.toChain) {
    return refuse("chain_mismatch", "The fresh quote is for different chains than the one you reviewed.");
  }
  if (!same(quote.fromAddress, reviewed.fromAddress)) return refuse("sender_mismatch", "The fresh quote sends from a different wallet.");
  if (!same(quote.toAddress, reviewed.toAddress)) return refuse("recipient_mismatch", "The fresh quote pays a different recipient.");
  if (!same(quote.fromToken.address, reviewed.fromToken)) return refuse("from_token_mismatch", "The fresh quote spends a different token.");
  if (!same(quote.toToken.address, reviewed.toToken)) return refuse("to_token_mismatch", "The fresh quote delivers a different token.");

  const reviewedAmount = parse(rules, reviewed.fromAmountAtomic);
  const quotedAmount = parse(rules, quote.fromAmountAtomic);
  const reviewedMin = parse(rules, reviewed.toAmountMinAtomic);
  const quotedMin = parse(rules, quote.toAmountMinAtomic);
  if (reviewedAmount === null || quotedAmount === null || reviewedMin === null || quotedMin === null) {
    return refuse("malformed_amount", "An amount in the quote is not a whole number of token units.");
  }
  if (quotedAmount !== reviewedAmount) return refuse("from_amount_mismatch", "The fresh quote spends a different amount.");
  if (quote.tool !== reviewed.tool) return refuse("tool_mismatch", `The fresh quote routes through ${quote.tool}, not ${reviewed.tool}.`);

  const proposal = bindTransaction(reviewed, quote, rules, quotedAmount);
  if ("status" in proposal) return proposal;
  if (quotedMin < reviewedMin) {
    return { status: "review", reason: "to_amount_min_lower", message: "The fresh quote's minimum received is lower than the one you reviewed.", quote };
  }
  return { status: "bound", proposal, quote };
}

/** The transaction half of R15: target, chain, sender and value (EVM) or PayBox's Solana rules. */
function bindTransaction(reviewed: ReviewedRoute, quote: NormalizedQuote, rules: R15Rules, amount: bigint): TransactionProposal | R15Result {
  const tx = quote.transaction;
  const evmChain = EIP155_CHAIN.exec(reviewed.fromChain);
  if (evmChain) {
    if (!tx || tx.family !== "evm") return refuse("missing_transaction", "The quote carries no EVM transaction.");
    if (tx.chainId !== Number(evmChain[1])) return refuse("tx_chain_mismatch", "The transaction is for a different chain.");
    if (tx.from !== null && !rules.sameAddress(tx.from, reviewed.fromAddress)) return refuse("tx_sender_mismatch", "The transaction is built for a different sender.");
    if (!rules.allowedTargets.some((allowed) => rules.sameAddress(allowed, tx.to))) {
      return refuse("target_not_allowed", "The transaction's target is not on LI.FI's contract allowlist for this chain.");
    }
    const value = parse(rules, tx.value);
    const native = rules.sameAddress(reviewed.fromToken, rules.nativeToken);
    if (value === null || value !== (native ? amount : ZERO_UNITS)) {
      return refuse("value_mismatch", native ? "The transaction sends a different amount of the native coin." : "The transaction also sends the native coin.");
    }
    return { kind: "evm", chain: reviewed.fromChain, to: tx.to, value: tx.value, data: tx.data };
  }
  if (!tx || tx.family !== "solana") return refuse("missing_transaction", "The quote carries no Solana transaction.");
  const check = checkSolanaTransaction(tx.transactionBase64, reviewed.fromAddress, {
    maxBytes: rules.solanaMaxBytes,
    requiredSigners: rules.solanaRequiredSigners,
  });
  if (!check.ok) return refuse(check.reason, check.message);
  return { kind: "solana", chain: reviewed.fromChain, transactionBase64: tx.transactionBase64 };
}
