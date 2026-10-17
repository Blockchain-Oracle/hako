// R15 binding (plan §12): each mismatched field is refused, a lower toAmountMin goes back for review, an equal or
// higher one binds; Solana size and signers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BASE, ETHEREUM, EVM_NATIVE_ADDRESS, LIFI_DIAMOND, SOLANA } from "@hako/networks";

import { bindQuote, type EvmTransactionRequest, type NormalizedQuote, type R15Result, type ReviewedRoute } from "../src/core/index.ts";
import { r15RulesFor } from "../src/server/rules.ts";
import { AMOUNT, BRIDGE_CALLDATA, encodeBase58, freshBridgeQuote, keyBytes, REVIEWED_MIN, reviewedBridge, solanaTx } from "./fixtures.ts";

const baseRules = r15RulesFor(BASE.caip2)!;
const solanaRules = r15RulesFor(SOLANA.caip2)!;
const OTHER_EVM = "0x1111111111111111111111111111111111111111";
const OTHER_KEY_SEED = 9;
const ONE_UNIT = 1n;

function expectRefused(result: R15Result, reason: string) {
  assert.equal(result.status, "refused", `expected a refusal (${reason}), got ${result.status}`);
  if (result.status === "refused") assert.equal(result.reason, reason);
}

describe("R15 on an EVM source (Base USDC → Solana USDC)", () => {
  it("binds a matching fresh quote into one EVM call to LI.FI's Diamond", () => {
    const result = bindQuote(reviewedBridge, freshBridgeQuote(), baseRules);
    assert.equal(result.status, "bound");
    if (result.status !== "bound") return;
    assert.deepEqual(result.proposal, { kind: "evm", chain: BASE.caip2, to: LIFI_DIAMOND, value: "0", data: BRIDGE_CALLDATA });
  });

  const mismatches: [string, Partial<NormalizedQuote>, string][] = [
    ["source chain", { fromChain: ETHEREUM.caip2 }, "chain_mismatch"],
    ["destination chain", { toChain: BASE.caip2 }, "chain_mismatch"],
    ["unknown chain", { toChain: null }, "unsupported_chain"],
    ["sender", { fromAddress: OTHER_EVM }, "sender_mismatch"],
    ["recipient", { toAddress: encodeBase58(keyBytes(OTHER_KEY_SEED)) }, "recipient_mismatch"],
    ["from-token", { fromToken: { address: EVM_NATIVE_ADDRESS, symbol: "ETH", decimals: 18, priceUsd: null, logoUri: null } }, "from_token_mismatch"],
    ["to-token", { toToken: { address: SOLANA.native.address, symbol: "SOL", decimals: 9, priceUsd: null, logoUri: null } }, "to_token_mismatch"],
    ["from-amount", { fromAmountAtomic: "1000001" }, "from_amount_mismatch"],
    ["LI.FI tool", { tool: "relaydepository" }, "tool_mismatch"],
  ];
  for (const [field, override, reason] of mismatches) {
    it(`refuses a different ${field}`, () => expectRefused(bindQuote(reviewedBridge, freshBridgeQuote(override), baseRules), reason));
  }

  const evmTx = (patch: Partial<EvmTransactionRequest>) => ({ transaction: { ...(freshBridgeQuote().transaction as EvmTransactionRequest), ...patch } });
  it("refuses a target that is not on LI.FI's allowlist", () => expectRefused(bindQuote(reviewedBridge, freshBridgeQuote(evmTx({ to: OTHER_EVM })), baseRules), "target_not_allowed"));
  it("refuses every target when the allowlist is empty", () =>
    expectRefused(bindQuote(reviewedBridge, freshBridgeQuote(), { ...baseRules, allowedTargets: [] }), "target_not_allowed"));
  it("refuses a transaction for another chain id", () => expectRefused(bindQuote(reviewedBridge, freshBridgeQuote(evmTx({ chainId: ETHEREUM.chainId })), baseRules), "tx_chain_mismatch"));
  it("refuses a transaction built for another sender", () => expectRefused(bindQuote(reviewedBridge, freshBridgeQuote(evmTx({ from: OTHER_EVM })), baseRules), "tx_sender_mismatch"));
  it("refuses native value on an ERC-20 move", () => expectRefused(bindQuote(reviewedBridge, freshBridgeQuote(evmTx({ value: "1" })), baseRules), "value_mismatch"));
  it("refuses a quote without a transaction", () => expectRefused(bindQuote(reviewedBridge, freshBridgeQuote({ transaction: null }), baseRules), "missing_transaction"));
  it("refuses a malformed amount", () => expectRefused(bindQuote(reviewedBridge, freshBridgeQuote({ toAmountMinAtomic: "9.9" }), baseRules), "malformed_amount"));

  it("binds a native-coin move only when the value equals the amount", () => {
    const reviewed: ReviewedRoute = { ...reviewedBridge, fromToken: EVM_NATIVE_ADDRESS };
    const native = { address: EVM_NATIVE_ADDRESS, symbol: "ETH", decimals: 18, priceUsd: null, logoUri: null };
    assert.equal(bindQuote(reviewed, freshBridgeQuote({ fromToken: native, ...evmTx({ value: AMOUNT }) }), baseRules).status, "bound");
    expectRefused(bindQuote(reviewed, freshBridgeQuote({ fromToken: native, ...evmTx({ value: "0" }) }), baseRules), "value_mismatch");
  });

  it("returns a lower toAmountMin for review instead of a proposal", () => {
    const lower = freshBridgeQuote({ toAmountMinAtomic: String(BigInt(REVIEWED_MIN) - ONE_UNIT) });
    const result = bindQuote(reviewedBridge, lower, baseRules);
    assert.equal(result.status, "review");
    if (result.status === "review") {
      assert.equal(result.reason, "to_amount_min_lower");
      assert.equal(result.quote, lower);
    }
  });
  it("accepts an equal toAmountMin", () => assert.equal(bindQuote(reviewedBridge, freshBridgeQuote({ toAmountMinAtomic: REVIEWED_MIN }), baseRules).status, "bound"));
  it("accepts a higher toAmountMin", () =>
    assert.equal(bindQuote(reviewedBridge, freshBridgeQuote({ toAmountMinAtomic: String(BigInt(REVIEWED_MIN) + ONE_UNIT) }), baseRules).status, "bound"));
  it("refuses before reviewing: a mismatch wins over a lower minimum", () =>
    expectRefused(bindQuote(reviewedBridge, freshBridgeQuote({ tool: "across", toAmountMinAtomic: "1" }), baseRules), "tool_mismatch"));
});

describe("R15 on a Solana source (Solana USDC → Base USDC)", () => {
  const sender = keyBytes(1);
  const reviewed: ReviewedRoute = {
    ...reviewedBridge,
    fromChain: SOLANA.caip2,
    toChain: BASE.caip2,
    fromToken: SOLANA.usdc.address,
    toToken: BASE.usdc.address,
    fromAddress: encodeBase58(sender),
    toAddress: reviewedBridge.fromAddress,
    tool: "relaydepository",
  };
  const quote = (transactionBase64: string): NormalizedQuote =>
    freshBridgeQuote({
      tool: "relaydepository",
      fromChainId: SOLANA.lifiChainId,
      toChainId: BASE.lifiChainId,
      fromChain: SOLANA.caip2,
      toChain: BASE.caip2,
      fromToken: { address: SOLANA.usdc.address, symbol: "USDC", decimals: 6, priceUsd: "1", logoUri: null },
      toToken: { address: BASE.usdc.address, symbol: "USDC", decimals: 6, priceUsd: "1", logoUri: null },
      fromAddress: reviewed.fromAddress,
      toAddress: reviewed.toAddress,
      approvalAddress: null,
      transaction: { family: "solana", transactionBase64 },
    });

  it("binds a legacy transaction with one empty signer slot for the sender", () => {
    const tx = solanaTx({ feePayer: sender });
    const result = bindQuote(reviewed, quote(tx), solanaRules);
    assert.equal(result.status, "bound");
    if (result.status === "bound") assert.deepEqual(result.proposal, { kind: "solana", chain: SOLANA.caip2, transactionBase64: tx });
  });
  it("binds a v0 transaction", () => assert.equal(bindQuote(reviewed, quote(solanaTx({ feePayer: sender, version: 0 })), solanaRules).status, "bound"));
  it("refuses more than SOLANA_TX_MAX_BYTES", () => {
    const tx = solanaTx({ feePayer: sender, extraKeys: Math.ceil(solanaRules.solanaMaxBytes / sender.length) });
    expectRefused(bindQuote(reviewed, quote(tx), solanaRules), "solana_too_large");
  });
  it("refuses two required signers", () => expectRefused(bindQuote(reviewed, quote(solanaTx({ feePayer: sender, slots: 2, requiredSigners: 2 })), solanaRules), "solana_signer_count"));
  it("refuses a slot count that disagrees with the header", () =>
    expectRefused(bindQuote(reviewed, quote(solanaTx({ feePayer: sender, slots: 2, requiredSigners: 1 })), solanaRules), "solana_signer_count"));
  it("refuses a signer that is not the sender", () => expectRefused(bindQuote(reviewed, quote(solanaTx({ feePayer: keyBytes(2) })), solanaRules), "solana_signer_not_sender"));
  it("refuses a pre-signed transaction", () => expectRefused(bindQuote(reviewed, quote(solanaTx({ feePayer: sender, presigned: true })), solanaRules), "solana_presigned"));
  it("refuses an unsupported message version", () => expectRefused(bindQuote(reviewed, quote(solanaTx({ feePayer: sender, version: 1 })), solanaRules), "solana_unsupported_version"));
  it("refuses bytes that are not a canonical base64 transaction", () => {
    expectRefused(bindQuote(reviewed, quote("not base64!"), solanaRules), "solana_malformed");
    expectRefused(bindQuote(reviewed, quote(solanaTx({ feePayer: sender }).replace(/=+$/, "")), solanaRules), "solana_malformed");
  });
  it("refuses an EVM transaction on a Solana source", () =>
    expectRefused(bindQuote(reviewed, { ...quote(solanaTx({ feePayer: sender })), transaction: freshBridgeQuote().transaction }, solanaRules), "missing_transaction"));
});
