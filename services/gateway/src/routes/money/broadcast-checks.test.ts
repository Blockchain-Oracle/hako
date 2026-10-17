/**
 * `/v1/broadcast`'s decode-and-check (plan §12 test policy: "decoded tx ≠ draft" is refused), on real landed mainnet
 * transactions (broadcast-checks.fixtures.ts). Pure: the sender is recovered from each signature, nothing is sent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BASE, ETHEREUM, SOLANA } from "@hako/networks";

import { type BroadcastExpectation, checkEvm, checkSolana } from "./broadcast-checks.js";
import { BASE_DIAMOND_CALL, BASE_EXACT_APPROVE, SOLANA_ONE_SIGNER } from "./broadcast-checks.fixtures.js";

type EvmFixture = typeof BASE_EXACT_APPROVE | typeof BASE_DIAMOND_CALL;

const evmExpectation = (fixture: EvmFixture, kind: BroadcastExpectation["kind"] = "send"): BroadcastExpectation => ({
  kind,
  tx: { family: "evm", chainId: BASE.chainId, to: fixture.to, data: fixture.data, value: fixture.value, from: fixture.from },
  reviewed: null,
});

/** The reviewed Base → Solana USDC route whose exact approve BASE_EXACT_APPROVE is. */
const reviewedBridge = (amountAtomic: string) => ({
  fromChain: BASE.caip2,
  toChain: SOLANA.caip2,
  fromToken: BASE_EXACT_APPROVE.to,
  toToken: SOLANA.usdc.address,
  fromAmountAtomic: amountAtomic,
  fromAddress: BASE_EXACT_APPROVE.from,
  toAddress: SOLANA_ONE_SIGNER.signer,
  tool: "relaydepository",
  minReceivedAtomic: amountAtomic,
});

const refusedFor = async (expectation: BroadcastExpectation, raw: string = BASE_EXACT_APPROVE.raw) => {
  const result = await checkEvm(BASE, raw, expectation);
  assert.equal(result.ok, false);
  return result.ok ? "" : result.reason;
};

describe("checkEvm", () => {
  it("accepts a signed transaction equal to its draft and recovers its sender", async () => {
    const result = await checkEvm(BASE, BASE_EXACT_APPROVE.raw, evmExpectation(BASE_EXACT_APPROVE));
    assert.ok(result.ok);
    assert.equal(result.tx.hash, BASE_EXACT_APPROVE.hash);
    assert.equal(result.tx.from.toLowerCase(), BASE_EXACT_APPROVE.from);
  });

  it("refuses every field that differs from the draft", async () => {
    const base = evmExpectation(BASE_EXACT_APPROVE);
    const evmTx = base.tx as Extract<BroadcastExpectation["tx"], { family: "evm" }>;
    const other = BASE_DIAMOND_CALL.from;
    assert.match(await refusedFor({ ...base, tx: { ...evmTx, from: other } }), /different wallet/);
    assert.match(await refusedFor({ ...base, tx: { ...evmTx, to: other } }), /different contract/);
    assert.match(await refusedFor({ ...base, tx: { ...evmTx, data: `${evmTx.data.slice(0, -1)}0` } }), /calldata differs/);
    assert.match(await refusedFor({ ...base, tx: { ...evmTx, value: BASE_DIAMOND_CALL.value } }), /native amount/);
    assert.match(await refusedFor({ ...base, tx: { ...evmTx, chainId: ETHEREUM.chainId } }), /not for Base/);
  });

  it("refuses bytes that are not a signed transaction", async () => {
    assert.match(await refusedFor(evmExpectation(BASE_EXACT_APPROVE), "0x02f8"), /could not be decoded/);
    assert.match(await refusedFor(evmExpectation(BASE_EXACT_APPROVE), SOLANA_ONE_SIGNER.signedTx), /not 0x hex/);
  });

  it("lets a LI.FI move approve exactly the reviewed amount to the allowlisted Diamond (R16)", async () => {
    const exact = { ...evmExpectation(BASE_EXACT_APPROVE, "bridge"), reviewed: reviewedBridge(BASE_EXACT_APPROVE.amountAtomic) };
    assert.ok((await checkEvm(BASE, BASE_EXACT_APPROVE.raw, exact)).ok);
    const more = { ...exact, reviewed: reviewedBridge(`${BASE_EXACT_APPROVE.amountAtomic}0`) };
    assert.match(await refusedFor(more), /approve exactly the reviewed amount/);
  });

  it("refuses a LI.FI move without its reviewed route, or reviewed on another chain", async () => {
    assert.match(await refusedFor(evmExpectation(BASE_EXACT_APPROVE, "swap")), /reviewed route/);
    const elsewhere = { ...reviewedBridge(BASE_EXACT_APPROVE.amountAtomic), fromChain: ETHEREUM.caip2 };
    assert.match(await refusedFor({ ...evmExpectation(BASE_EXACT_APPROVE, "bridge"), reviewed: elsewhere }), /does not start on Base/);
  });

  it("accepts a LI.FI move that calls the allowlisted Diamond", async () => {
    const reviewed = { ...reviewedBridge(BASE_DIAMOND_CALL.value), fromToken: BASE.native.address, fromAddress: BASE_DIAMOND_CALL.from };
    const result = await checkEvm(BASE, BASE_DIAMOND_CALL.raw, { ...evmExpectation(BASE_DIAMOND_CALL, "bridge"), reviewed });
    assert.ok(result.ok);
    assert.equal(result.tx.hash, BASE_DIAMOND_CALL.hash);
  });
});

describe("checkSolana", () => {
  const expectation: BroadcastExpectation = {
    kind: "send",
    tx: { family: "solana", signer: SOLANA_ONE_SIGNER.signer, messageBase64: SOLANA_ONE_SIGNER.messageBase64 },
    reviewed: null,
  };
  const refused = (draft: BroadcastExpectation, signedTx: string = SOLANA_ONE_SIGNER.signedTx) => {
    const result = checkSolana(signedTx, draft);
    assert.equal(result.ok, false);
    return result.ok ? "" : result.reason;
  };

  it("accepts a signed transaction whose signer, message and signature match the draft", () => {
    const result = checkSolana(SOLANA_ONE_SIGNER.signedTx, expectation);
    assert.ok(result.ok);
    assert.equal(result.tx.signature, SOLANA_ONE_SIGNER.signature);
  });

  it("refuses another signer, another message, a forged signature and an EVM draft", () => {
    const solanaTx = expectation.tx as Extract<BroadcastExpectation["tx"], { family: "solana" }>;
    assert.match(refused({ ...expectation, tx: { ...solanaTx, signer: SOLANA.usdc.address } }), /signer is not/);
    const flip = (bytes: Buffer, index: number) => bytes.writeUInt8(bytes.readUInt8(index) ^ 1, index);
    const message = Buffer.from(solanaTx.messageBase64, "base64");
    flip(message, message.length - 1);
    assert.match(refused({ ...expectation, tx: { ...solanaTx, messageBase64: message.toString("base64") } }), /message differs/);
    // Byte 0 counts the signatures; byte 1 is the first byte of the signature itself.
    const forged = Buffer.from(SOLANA_ONE_SIGNER.signedTx, "base64");
    flip(forged, 1);
    assert.match(refused(expectation, forged.toString("base64")), /does not verify/);
    assert.match(refused(evmExpectation(BASE_EXACT_APPROVE)), /EVM transaction/);
  });
});
