/**
 * R16, the approve sequence: an ERC-20 move whose allowance is short starts with an approve for exactly the amount
 * (never "unlimited"), proposed alone ("Step 1 of 2"). When that request reaches `success`, the caller asks LI.FI for
 * a FRESH quote pinned to the same tool and binds it with R15 before proposing the transfer (step 2). Native coins
 * and Solana need no approve. Anything unclear fails closed.
 */
import type { AmountHelpers, AtomicString, ChainId, EvmCallProposal } from "./types.ts";
import { ABI_WORD_HEX_CHARS, ERC20_APPROVE_SELECTOR, EVM_ADDRESS_PATTERN, HEX_RADIX, UINT256_MAX, ZERO_UNITS } from "./wire.config.ts";

/** `approve(spender, amount)` calldata, exact amount. Throws on a malformed spender or an amount outside uint256. */
export function erc20ApproveCalldata(spender: string, amount: bigint): string {
  if (!EVM_ADDRESS_PATTERN.test(spender)) throw new RangeError(`Not an EVM address: ${spender}`);
  if (amount < ZERO_UNITS || amount > UINT256_MAX) throw new RangeError("The approve amount must fit in uint256.");
  const word = (hex: string) => hex.padStart(ABI_WORD_HEX_CHARS, "0");
  return `${ERC20_APPROVE_SELECTOR}${word(spender.slice(2).toLowerCase())}${word(amount.toString(HEX_RADIX))}`;
}

export interface ApproveCheckInput {
  /** The source chain (CAIP-2, `eip155:<id>`). */
  chain: ChainId;
  /** The token being moved. */
  token: string;
  /** The wallet that moves it. */
  owner: string;
  /** The quote's `approvalAddress` (LI.FI's Diamond), or null when LI.FI named none. */
  spender: string | null;
  amountAtomic: AtomicString;
  /** `allowance(owner, spender)` read on-chain just now, or null when it couldn't be read. */
  allowanceAtomic: AtomicString | null;
  /** True when `token` is the chain's native coin (paid as `value`, nothing to approve). */
  native: boolean;
  /** LI.FI's `approvalReset` flag: the token must be approved to 0 before a new non-zero approve (USDT-style). */
  approvalReset?: boolean;
}

export interface R16Rules extends AmountHelpers {
  /** Spenders an approve may name: LI.FI's allowlist for the source chain (@hako/networks LIFI_CONTRACT_ALLOWLIST). */
  allowedSpenders: readonly string[];
}

export type R16RefusalReason = "not_evm" | "malformed_amount" | "missing_spender" | "spender_not_allowed" | "allowance_unknown" | "approval_reset_unsupported";

export type R16Plan =
  /** No approve needed: get a fresh quote pinned to the tool and bind it with R15. */
  | { step: "transfer"; reason: "native" | "allowance_sufficient" }
  /** Propose this approve alone; after it reaches `success`, call again: the allowance then covers the amount. */
  | { step: "approve"; stepIndex: 1; stepCount: 2; token: string; spender: string; amountAtomic: AtomicString; proposal: EvmCallProposal }
  | { step: "refused"; reason: R16RefusalReason; message: string };

const EIP155 = "eip155:";

export function planApproveSequence(input: ApproveCheckInput, rules: R16Rules): R16Plan {
  if (!input.chain.startsWith(EIP155)) return { step: "refused", reason: "not_evm", message: "Only EVM moves have an approve step." };
  if (input.native) return { step: "transfer", reason: "native" };
  let amount: bigint;
  try {
    amount = rules.parseAtomic(input.amountAtomic);
  } catch {
    return { step: "refused", reason: "malformed_amount", message: "The amount is not a whole number of token units." };
  }
  const spender = input.spender;
  if (!spender) return { step: "refused", reason: "missing_spender", message: "The quote names no spender to approve." };
  if (!rules.allowedSpenders.some((allowed) => rules.sameAddress(allowed, spender))) {
    return { step: "refused", reason: "spender_not_allowed", message: "The spender is not on LI.FI's contract allowlist for this chain." };
  }
  if (input.allowanceAtomic === null) return { step: "refused", reason: "allowance_unknown", message: "The current allowance could not be read." };
  let allowance: bigint;
  try {
    allowance = rules.parseAtomic(input.allowanceAtomic);
  } catch {
    return { step: "refused", reason: "allowance_unknown", message: "The current allowance could not be read." };
  }
  if (allowance >= amount) return { step: "transfer", reason: "allowance_sufficient" };
  if (input.approvalReset && allowance > ZERO_UNITS) {
    return { step: "refused", reason: "approval_reset_unsupported", message: "This token must be approved to zero first, which Hako doesn't do." };
  }
  return {
    step: "approve",
    stepIndex: 1,
    stepCount: 2,
    token: input.token,
    spender,
    amountAtomic: input.amountAtomic,
    proposal: { kind: "evm", chain: input.chain, to: input.token, value: "0", data: erc20ApproveCalldata(spender, amount) },
  };
}
