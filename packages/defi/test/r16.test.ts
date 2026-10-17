// R16 approve sequence (plan §12 "approve → fresh quote → transfer"): an exact-amount approve when the allowance is
// short, nothing to approve for a native coin or a covering allowance, and refusals that fail closed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BASE, EVM_NATIVE_ADDRESS, LIFI_DIAMOND, SOLANA } from "@hako/networks";

import { bindQuote, erc20ApproveCalldata, HEX_RADIX, planApproveSequence, UINT256_MAX, type ApproveCheckInput } from "../src/core/index.ts";
import { r15RulesFor, r16RulesFor } from "../src/rules.ts";
import { AMOUNT, EVM_SENDER, freshBridgeQuote, reviewedBridge } from "./fixtures.ts";

const rules = r16RulesFor(BASE.caip2)!;
const ONE_UNIT = 1n;
const OTHER_SPENDER = "0x89c6340B1a1f4b25D36cd8B063D49045caF3f818";
const input = (patch: Partial<ApproveCheckInput> = {}): ApproveCheckInput => ({
  chain: BASE.caip2,
  token: BASE.usdc.address,
  owner: EVM_SENDER,
  spender: LIFI_DIAMOND,
  amountAtomic: AMOUNT,
  allowanceAtomic: "0",
  native: false,
  ...patch,
});
const ABI_WORD = (hex: string) => hex.padStart(UINT256_MAX.toString(HEX_RADIX).length, "0");

describe("erc20ApproveCalldata", () => {
  it("encodes approve(spender, exact amount)", () => {
    const expected = `0x095ea7b3${ABI_WORD(LIFI_DIAMOND.slice(2).toLowerCase())}${ABI_WORD(BigInt(AMOUNT).toString(HEX_RADIX))}`;
    assert.equal(erc20ApproveCalldata(LIFI_DIAMOND, BigInt(AMOUNT)), expected);
  });
  it("refuses a malformed spender and an amount outside uint256", () => {
    assert.throws(() => erc20ApproveCalldata("0x1234", ONE_UNIT), RangeError);
    assert.throws(() => erc20ApproveCalldata(LIFI_DIAMOND, UINT256_MAX + ONE_UNIT), RangeError);
    assert.throws(() => erc20ApproveCalldata(LIFI_DIAMOND, -ONE_UNIT), RangeError);
  });
});

describe("planApproveSequence", () => {
  it("proposes an approve for exactly the amount when the allowance is short (step 1 of 2)", () => {
    const plan = planApproveSequence(input({ allowanceAtomic: "999999" }), rules);
    assert.equal(plan.step, "approve");
    if (plan.step !== "approve") return;
    assert.equal(plan.stepIndex, 1);
    assert.equal(plan.stepCount, 2);
    assert.equal(plan.amountAtomic, AMOUNT);
    assert.deepEqual(plan.proposal, { kind: "evm", chain: BASE.caip2, to: BASE.usdc.address, value: "0", data: erc20ApproveCalldata(LIFI_DIAMOND, BigInt(AMOUNT)) });
  });

  it("goes straight to the transfer when the allowance covers the amount, then R15 binds the fresh quote", () => {
    assert.deepEqual(planApproveSequence(input({ allowanceAtomic: AMOUNT }), rules), { step: "transfer", reason: "allowance_sufficient" });
    // After the approve reached success: a fresh quote pinned to the same tool binds into the transfer (step 2).
    assert.equal(bindQuote(reviewedBridge, freshBridgeQuote(), r15RulesFor(BASE.caip2)!).status, "bound");
  });

  it("needs no approve for the native coin", () =>
    assert.deepEqual(planApproveSequence(input({ token: EVM_NATIVE_ADDRESS, native: true, spender: null, allowanceAtomic: null }), rules), { step: "transfer", reason: "native" }));

  const refusals: [string, Partial<ApproveCheckInput>, string][] = [
    ["a spender off LI.FI's allowlist (Permit2Proxy)", { spender: OTHER_SPENDER }, "spender_not_allowed"],
    ["no spender", { spender: null }, "missing_spender"],
    ["an allowance that couldn't be read", { allowanceAtomic: null }, "allowance_unknown"],
    ["a malformed amount", { amountAtomic: "1.5" }, "malformed_amount"],
    ["a non-EVM chain", { chain: SOLANA.caip2 }, "not_evm"],
    ["a token that must be reset to zero first", { allowanceAtomic: "1", approvalReset: true }, "approval_reset_unsupported"],
  ];
  for (const [what, patch, reason] of refusals) {
    it(`refuses ${what}`, () => {
      const plan = planApproveSequence(input(patch), rules);
      assert.equal(plan.step, "refused");
      if (plan.step === "refused") assert.equal(plan.reason, reason);
    });
  }

  it("approves a reset-style token from a zero allowance", () => assert.equal(planApproveSequence(input({ approvalReset: true }), rules).step, "approve"));
});
