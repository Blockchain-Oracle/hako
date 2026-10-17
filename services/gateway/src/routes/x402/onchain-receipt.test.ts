/**
 * A receipt binds the transaction to the caller's send draft (plan §12: decoded tx ≠ draft is refused): sender,
 * recipient, token and amount must all match, so nobody records someone else's transfer as their own.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { networkByCaip2 } from "@hako/networks";

import { sentAsDrafted } from "./onchain-receipt.js";

const base = networkByCaip2("eip155:8453")!;
const USDC = base.usdc.address;
const NATIVE = base.native.address;
const SENDER = "0x92a3d3e85c701e00ea48998116c94bc0ee4bbf0a";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const OTHER = "0x8164000000000000000000000000000000c0948d";
const HASH = "0xabababababababababababababababababababababababababababababababab";

const usdcSend = { chain: base.caip2, token: USDC, amountAtomic: "100000", from: SENDER, to: RECIPIENT };
const usdcTx = (transfer: { from?: string; to?: string; amount_atomic?: string; token?: string }, from = SENDER) => ({
  chain: base.caip2,
  hash: HASH,
  status: "success" as const,
  from,
  to: USDC,
  transfers: [{ token: USDC, from: SENDER, to: RECIPIENT, amount_atomic: "100000", ...transfer }],
});

describe("a receipt is the draft's send", () => {
  it("accepts the drafted token transfer (addresses in any case)", () => {
    const tx = usdcTx({ to: RECIPIENT.toLowerCase() }, SENDER.toUpperCase().replace("0X", "0x"));
    assert.deepEqual(sentAsDrafted(tx, usdcSend, NATIVE), { asset: USDC, amountAtomic: "100000", payTo: RECIPIENT });
  });

  it("refuses another sender, recipient, amount or token", () => {
    assert.equal(sentAsDrafted(usdcTx({}, OTHER), usdcSend, NATIVE), null, "someone else's transaction");
    assert.equal(sentAsDrafted(usdcTx({ to: OTHER }), usdcSend, NATIVE), null, "another recipient");
    assert.equal(sentAsDrafted(usdcTx({ amount_atomic: "99999" }), usdcSend, NATIVE), null, "another amount");
    assert.equal(sentAsDrafted(usdcTx({ token: OTHER }), usdcSend, NATIVE), null, "another token");
  });

  it("binds a native send by its value and recipient", () => {
    const send = { ...usdcSend, token: NATIVE, amountAtomic: "1000" };
    const tx = { chain: base.caip2, hash: HASH, status: "success" as const, from: SENDER, to: RECIPIENT, value_atomic: "1000" };
    assert.deepEqual(sentAsDrafted(tx, send, NATIVE), { asset: NATIVE, amountAtomic: "1000", payTo: RECIPIENT });
    assert.equal(sentAsDrafted({ ...tx, value_atomic: "999" }, send, NATIVE), null);
    assert.equal(sentAsDrafted({ ...tx, to: OTHER }, send, NATIVE), null);
  });

  it("waits for a pending token send's logs, and records a reverted one as the draft's (nothing moved)", () => {
    const call = { chain: base.caip2, hash: HASH, from: SENDER, to: USDC, transfers: [] };
    assert.equal(sentAsDrafted({ ...call, status: "pending" }, usdcSend, NATIVE), "pending");
    assert.deepEqual(sentAsDrafted({ ...call, status: "reverted" }, usdcSend, NATIVE), { asset: USDC, amountAtomic: "100000", payTo: RECIPIENT });
    assert.equal(sentAsDrafted({ ...call, status: "reverted", from: OTHER }, usdcSend, NATIVE), null);
  });
});
