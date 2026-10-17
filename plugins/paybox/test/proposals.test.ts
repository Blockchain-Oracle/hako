/**
 * Plan §12, the money tests: proposal builders (amount units, approve → fresh quote → transfer, Solana size and
 * signers) and R15 binding (each mismatched field refused, a lower minimum sent back for review, equal or higher bound).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { erc20ApproveCalldata } from "../../../packages/defi/src/core/index.ts";
import { LIFI_DIAMOND } from "../../../packages/networks/src/index.ts";
import { HakoError } from "../src/errors.js";
import { amountText, executableChain, proposalExpiry, proposeApproveStep, proposeMove, proposeTransferStep } from "../src/proposals.js";
import { proposeEarnMove } from "../src/tools/earn.js";
import type { ProposalResponse } from "../src/wire/money.js";
import {
  BASE_USDC,
  earnDepositBody,
  earnDepositRoute,
  EVM_WALLET,
  MIN_RECEIVED,
  ONE_USDC,
  reviewedBaseToSolana,
  route,
  SOL_USDC,
  SOL_WALLET,
  solanaTx,
  TOOL,
  transfer,
} from "./fixtures.js";

const KEY = "io.paybox/transactionProposal";

function refusedWith(code: string, run: () => unknown, reason?: RegExp) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof HakoError, `expected a HakoError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (reason) assert.match(error.message, reason);
    return true;
  });
}

const approve = (overrides: Partial<Extract<ProposalResponse, { step: "approve" }>> = {}): Extract<ProposalResponse, { step: "approve" }> => ({
  step: "approve",
  chain: "eip155:8453",
  token: { chain: "eip155:8453", address: BASE_USDC, symbol: "USDC", decimals: 6 },
  spender: LIFI_DIAMOND,
  amountAtomic: ONE_USDC,
  tx: { chainId: 8453, to: BASE_USDC, value: "0", data: erc20ApproveCalldata(LIFI_DIAMOND, BigInt(ONE_USDC)) },
  ...overrides,
});

describe("amount units", () => {
  it("formats atomic units without floats", () => {
    assert.equal(amountText("5000", 6, "USDC"), "0.005 USDC");
    assert.equal(amountText(ONE_USDC, 6, "USDC"), "1 USDC");
    assert.equal(amountText("1", 18, "ETH"), "0.000000000000000001 ETH");
  });

  it("caps the expiry at four minutes, whole seconds, and never past the quote", () => {
    const now = Date.parse("2026-10-17T20:00:00.500Z");
    assert.equal(proposalExpiry(null, now), "2026-10-17T20:04:00Z");
    assert.equal(proposalExpiry("2026-10-17T20:01:30.900Z", now), "2026-10-17T20:01:30Z");
    assert.equal(proposalExpiry("2026-10-17T20:30:00Z", now), "2026-10-17T20:04:00Z");
    refusedWith("quote_expired", () => proposalExpiry("2026-10-17T20:00:10Z", now));
  });
});

describe("R17: executable source chains", () => {
  it("signs from Base and Solana only", () => {
    assert.equal(executableChain("eip155:8453"), "eip155:8453");
    assert.equal(executableChain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), "solana:mainnet");
    refusedWith("chain_not_executable", () => executableChain("eip155:1"), /Ethereum/);
    refusedWith("chain_not_executable", () => executableChain("eip155:999999"));
  });
});

describe("R16: step 1 is the exact approve", () => {
  it("proposes exactly the amount to the allowlisted spender, alone", () => {
    const result = proposeApproveStep(reviewedBaseToSolana(), approve(), "hako_bridge");
    const proposal = result.structuredContent[KEY];
    assert.equal(proposal.kind, "evm");
    assert.equal(proposal.chain, "eip155:8453");
    assert.ok(proposal.kind === "evm");
    assert.equal(proposal.transaction.to, BASE_USDC);
    assert.equal(proposal.transaction.value, "0");
    assert.equal(proposal.transaction.data, erc20ApproveCalldata(LIFI_DIAMOND, BigInt(ONE_USDC)));
    assert.match(result.content[0]!.text, /^Step 1 of 2: approve exactly 1 USDC/);
    assert.match(result.content[0]!.text, /call hako_bridge again with the same input/);
  });

  it("refuses an approve that isn't exact, allowlisted and for the moved token", () => {
    const unlimited = erc20ApproveCalldata(LIFI_DIAMOND, 2n ** 256n - 1n);
    refusedWith("r16_refused", () => proposeApproveStep(reviewedBaseToSolana(), approve({ amountAtomic: "2000000" }), "hako_bridge"), /exactly/);
    refusedWith("r16_refused", () => proposeApproveStep(reviewedBaseToSolana(), approve({ tx: { ...approve().tx, data: unlimited } }), "hako_bridge"), /exact approve/);
    refusedWith("r16_refused", () => proposeApproveStep(reviewedBaseToSolana(), approve({ spender: EVM_WALLET }), "hako_bridge"), /allowlist/);
    refusedWith(
      "r16_refused",
      () => proposeApproveStep(reviewedBaseToSolana(), approve({ token: { ...approve().token, address: "0x4200000000000000000000000000000000000006" } }), "hako_bridge"),
      /different token/,
    );
    const native = { ...reviewedBaseToSolana(), fromToken: "0x0000000000000000000000000000000000000000" };
    refusedWith("r16_refused", () => proposeApproveStep(native, approve(), "hako_bridge"), /needs no approve/);
    refusedWith("r16_refused", () => proposeApproveStep(reviewedBaseToSolana(), approve({ tx: { ...approve().tx, value: "1" } }), "hako_bridge"));
  });

  it("then the fresh quote's transfer is bound and proposed (step 2)", () => {
    const result = proposeMove(reviewedBaseToSolana(), transfer(), "hako_bridge", "Bridge");
    const proposal = result.structuredContent[KEY];
    assert.ok(proposal.kind === "evm");
    assert.equal(proposal.chain, "eip155:8453");
    assert.equal(proposal.transaction.to, LIFI_DIAMOND);
    assert.equal(proposal.transaction.value, "0");
    assert.equal(proposal.transaction.data, "0xabcdef01");
    assert.match(result.content[0]!.text, /Bridge 1 USDC on Base → at least 0\.99 USDC on Solana via Relay/);
  });
});

describe("R15: the fresh quote binds to the reviewed route or is refused", () => {
  const cases: Array<[string, Parameters<typeof transfer>[0], Parameters<typeof transfer>[1], RegExp]> = [
    ["chain", { toChain: "eip155:42161" }, {}, /chain_mismatch/],
    ["sender", { fromAddress: "0x1111111111111111111111111111111111111111" }, {}, /sender_mismatch/],
    ["recipient", { toAddress: "4UsEm6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaVR5r" }, {}, /recipient_mismatch/],
    ["from token", { fromToken: { chain: "eip155:8453", address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 } }, {}, /from_token_mismatch/],
    ["to token", { toToken: { chain: "solana:mainnet", address: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 } }, {}, /to_token_mismatch/],
    ["amount", { fromAmountAtomic: "1000001" }, {}, /from_amount_mismatch/],
    ["tool", { tool: "across" }, {}, /tool_mismatch/],
    ["target", {}, { to: EVM_WALLET }, /target_not_allowed/],
    ["tx chain", {}, { chainId: 1 }, /tx_chain_mismatch/],
    ["native value", {}, { value: "1" }, /value_mismatch/],
  ];
  for (const [field, routeChange, txChange, reason] of cases) {
    it(`refuses a different ${field}`, () => {
      refusedWith("r15_refused", () => proposeTransferStep(reviewedBaseToSolana(), transfer(routeChange, txChange), "hako_bridge", "Bridge"), reason);
    });
  }

  it("sends a lower minimum back for review instead of proposing", () => {
    refusedWith("quote_needs_review", () => proposeMove(reviewedBaseToSolana(), transfer({ toAmountMinAtomic: "989999" }), "hako_bridge", "Bridge"), /minReceivedAtomic "989999"/);
  });

  it("binds an equal or higher minimum", () => {
    for (const min of [MIN_RECEIVED, "995000"]) {
      const result = proposeMove(reviewedBaseToSolana(), transfer({ toAmountMinAtomic: min }), "hako_bridge", "Bridge");
      assert.equal(result.structuredContent[KEY].kind, "evm");
    }
  });

  it("never proposes before a minimum was reviewed", () => {
    const unreviewed = { ...reviewedBaseToSolana(), toAmountMinAtomic: "0" };
    refusedWith("quote_needs_review", () => proposeMove(unreviewed, transfer(), "hako_bridge", "Bridge"), /No minimum received was reviewed/);
  });

  it("passes the gateway's own review answer through as a review", () => {
    const review: ProposalResponse = { step: "review", route: route({ toAmountMinAtomic: "980000" }), reason: "The minimum dropped." };
    refusedWith("quote_needs_review", () => proposeMove(reviewedBaseToSolana(), review, "hako_bridge", "Bridge"), /0\.98 USDC/);
  });

  it("refuses a quote that expires before it could be signed", () => {
    const soon = new Date(Date.now() + 5_000).toISOString();
    refusedWith("quote_expired", () => proposeMove(reviewedBaseToSolana(), transfer({ expiresAt: soon }), "hako_bridge", "Bridge"));
  });
});

describe("Earn moves: R15 binds the LI.FI tool the person reviewed", () => {
  it("sends a quote back for review when no tool was reviewed yet, naming its tool", () => {
    refusedWith(
      "quote_needs_review",
      () => proposeEarnMove(earnDepositBody(), "deposit", transfer(earnDepositRoute)),
      new RegExp(`^No LI\\.FI tool was reviewed yet.*minReceivedAtomic "${MIN_RECEIVED}" \\(tool "${TOOL}"\\)`),
    );
    const review: ProposalResponse = { step: "review", route: route(earnDepositRoute), reason: "The minimum dropped." };
    refusedWith("quote_needs_review", () => proposeEarnMove(earnDepositBody(), "withdraw", review), /No LI\.FI tool was reviewed yet.*hako_earn_withdraw/);
  });

  it("refuses a quote from a different tool than the reviewed one", () => {
    refusedWith("r15_refused", () => proposeEarnMove(earnDepositBody("across"), "deposit", transfer(earnDepositRoute)), /tool_mismatch/);
  });

  it("binds the reviewed tool and proposes the deposit", () => {
    const result = proposeEarnMove(earnDepositBody(TOOL), "deposit", transfer(earnDepositRoute));
    assert.equal(result.structuredContent[KEY].kind, "evm");
    assert.match(result.content[0]!.text, /^Deposit 1 USDC on Base → at least 0\.99 aBasUSDC on Base/);
  });

  it("still proposes the exact approve first, before any tool is reviewed", () => {
    const result = proposeEarnMove(earnDepositBody(), "deposit", approve());
    assert.match(result.content[0]!.text, /^Step 1 of 2: approve exactly 1 USDC.*call hako_earn_deposit again/);
  });
});

describe("Solana source: one transaction, at most 1,232 bytes, one signer who is the sender", () => {
  const reviewed = () => ({
    ...reviewedBaseToSolana(),
    fromChain: "solana:mainnet",
    toChain: "eip155:8453",
    fromToken: SOL_USDC,
    toToken: BASE_USDC,
    fromAddress: SOL_WALLET,
    toAddress: EVM_WALLET,
  });
  const solRoute = {
    fromChain: "solana:mainnet" as const,
    toChain: "eip155:8453" as const,
    fromToken: { chain: "solana:mainnet" as const, address: SOL_USDC, symbol: "USDC", decimals: 6 },
    toToken: { chain: "eip155:8453" as const, address: BASE_USDC, symbol: "USDC", decimals: 6 },
    fromAddress: SOL_WALLET,
    toAddress: EVM_WALLET,
    approvalAddress: null,
  };
  const solTransfer = (tx: string): ProposalResponse => ({ step: "transfer", route: route(solRoute), tx: { transactionBase64: tx, signer: SOL_WALLET, bytes: Buffer.from(tx, "base64").length } });

  it("proposes the single-signer transaction as LI.FI built it", () => {
    const tx = solanaTx(SOL_WALLET);
    const result = proposeMove(reviewed(), solTransfer(tx), "hako_bridge", "Bridge");
    const proposal = result.structuredContent[KEY];
    assert.ok(proposal.kind === "solana");
    assert.equal(proposal.chain, "solana:mainnet");
    assert.equal(proposal.transaction.transactionBase64, tx);
  });

  it("refuses extra signers, a pre-signed payload, a different fee payer and an oversized transaction", () => {
    refusedWith("r15_refused", () => proposeMove(reviewed(), solTransfer(solanaTx(SOL_WALLET, { slots: 2, requiredSigners: 2 })), "hako_bridge", "Bridge"), /solana_signer_count/);
    refusedWith("r15_refused", () => proposeMove(reviewed(), solTransfer(solanaTx(SOL_WALLET, { presigned: true })), "hako_bridge", "Bridge"), /solana_presigned/);
    refusedWith("r15_refused", () => proposeMove(reviewed(), solTransfer(solanaTx("11111111111111111111111111111111")), "hako_bridge", "Bridge"), /solana_signer_not_sender/);
    refusedWith("r15_refused", () => proposeMove(reviewed(), solTransfer(solanaTx(SOL_WALLET, { padTo: 1_233 })), "hako_bridge", "Bridge"), /solana_too_large/);
  });
});
