/**
 * Batches (plan §12 test policy): all-or-nothing, pricing from the stored batch, unknown id → 404 never 402.
 * The routes run in a real Hono app with the real x402 middleware; only the facilitator (no chain, no money) and
 * hako-api (the tool router) are local stand-ins, so nothing here can pay or charge anyone.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired } from "@x402/core/types";
import { Hono } from "hono";

import type { CatalogEndpoint } from "../../catalog.js";
import { HTTP_BAD_GATEWAY, HTTP_NOT_FOUND, HTTP_OK, HTTP_UNPROCESSABLE } from "../../constants.js";
import type { Forwarded } from "../../forward.js";
import { registerBatch } from "../batch.js";
import type { X402Context } from "./context.js";
import { memoryStore } from "./kv.js";
import { HTTP_PAYMENT_REQUIRED } from "./x402.config.js";

const NETWORK = "eip155:8453" as const;
const PAY_TO = "0x8164000000000000000000000000000000c0948d" as const;
const PAYER = "0x92a3000000000000000000000000000000001bf0";
const TX = "0xabababababababababababababababababababababababababababababababab";
const SIGNATURE = "0x1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111";
const NONCE = "0x2222222222222222222222222222222222222222222222222222222222222222";

function endpoint(id: string, atomic: string, usd: string): CatalogEndpoint {
  const [provider = "", slug = ""] = id.split("/");
  return {
    id, provider, providerName: provider, slug, displayName: id, summary: id, description: id, categories: [], render: "table",
    price: { usd, atomic, tier: "local", network: NETWORK },
    method: "POST", path: `/v1/run/${id}`, available: true, input: {}, output: {}, example: {},
  };
}

const json = (status: number, body: unknown): Forwarded => ({ status, body: JSON.stringify(body), contentType: "application/json" });

interface Harness {
  app: Hono;
  endpoints: Map<string, CatalogEndpoint>;
  settled: number;
  runs: number;
  failing: Set<string>;
}

function harness(): Harness {
  const endpoints = new Map(
    [endpoint("openweather/current", "1000", "0.001"), endpoint("frankfurter/convert", "2500", "0.0025")].map((e) => [e.path, e]),
  );
  const h: Harness = { app: new Hono(), endpoints, settled: 0, runs: 0, failing: new Set() };
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} }),
    verify: async () => ({ isValid: true, payer: PAYER }),
    settle: async () => {
      h.settled += 1;
      return { success: true, transaction: TX, network: NETWORK, payer: PAYER };
    },
  };
  const ctx: X402Context = {
    publicBaseUrl: "https://gateway.test",
    rail: { network: NETWORK, payTo: PAY_TO, facilitator },
    kv: memoryStore(),
    pool: null,
    endpoints: () => h.endpoints,
    api: {
      validate: async (_id, body) =>
        (JSON.parse(body) as { bad?: boolean }).bad
          ? json(HTTP_UNPROCESSABLE, { error: { code: "invalid_input", message: "input does not match", details: ["body: bad"] } })
          : json(HTTP_OK, { valid: true }),
      run: async (id) => {
        h.runs += 1;
        return h.failing.has(id) ? json(HTTP_BAD_GATEWAY, { error: { code: "upstream" } }) : json(HTTP_OK, { billable: true, data: { tool: id } });
      },
      file: async () => new Response(null, { status: HTTP_NOT_FOUND }),
    },
    sessions: async () => ({ status: "none" }),
    fetch: globalThis.fetch,
  };
  registerBatch(h.app, ctx);
  return h;
}

async function createBatch(h: Harness, calls: Array<{ id: string; input: Record<string, unknown> }>) {
  const res = await h.app.request("/v1/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ calls }) });
  return { status: res.status, body: (await res.json()) as { batchId: string; priceAtomic: string; paidUrl: string } };
}

function challenge(res: Response): PaymentRequired {
  const header = res.headers.get("payment-required");
  assert.ok(header, "a 402 carries its PAYMENT-REQUIRED challenge");
  return decodePaymentRequiredHeader(header);
}

/** What a buyer sends back: the accepted requirements and a signed authorization (verified by the local facilitator). */
function paymentFor(required: PaymentRequired): string {
  const accepted = required.accepts[0]!;
  return encodePaymentSignatureHeader({
    x402Version: 2,
    resource: required.resource,
    accepted,
    payload: { signature: SIGNATURE, authorization: { from: PAYER, to: accepted.payTo, value: accepted.amount, validAfter: "0", validBefore: "9999999999", nonce: NONCE } },
  });
}

describe("batches", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("answers 404, never a 402, for an unknown or expired batch id", async () => {
    const res = await h.app.request("/v2/batch/not-a-batch");
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.equal(res.headers.get("payment-required"), null);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "unknown_batch");
  });

  it("prices the stored batch: the frozen sum, whatever the catalog says later", async () => {
    const created = await createBatch(h, [
      { id: "openweather/current", input: { city: "Lagos" } },
      { id: "frankfurter/convert", input: { from: "USD", to: "NGN" } },
    ]);
    assert.equal(created.status, HTTP_OK);
    assert.equal(created.body.priceAtomic, "3500");
    assert.equal(created.body.paidUrl, `https://gateway.test/v2/batch/${created.body.batchId}`);

    h.endpoints.set("/v1/run/openweather/current", endpoint("openweather/current", "90000", "0.09"));
    const res = await h.app.request(`/v2/batch/${created.body.batchId}`);
    assert.equal(res.status, HTTP_PAYMENT_REQUIRED);
    const accepted = challenge(res).accepts[0]!;
    assert.equal(accepted.amount, "3500");
    assert.equal(accepted.payTo, PAY_TO);
    assert.equal(accepted.network, NETWORK);
    assert.equal(challenge(res).resource.url, `https://gateway.test/v2/batch/${created.body.batchId}`);
  });

  it("settles only when every call succeeds, then answers the stored result and never asks again", async () => {
    const created = await createBatch(h, [
      { id: "openweather/current", input: { city: "Lagos" } },
      { id: "frankfurter/convert", input: { from: "USD", to: "NGN" } },
    ]);
    const path = `/v2/batch/${created.body.batchId}`;
    const payment = paymentFor(challenge(await h.app.request(path)));

    h.failing.add("frankfurter/convert");
    const failed = await h.app.request(path, { headers: { "payment-signature": payment } });
    assert.equal(failed.status, HTTP_BAD_GATEWAY);
    assert.equal(((await failed.json()) as { error: { code: string } }).error.code, "batch_incomplete");
    assert.equal(h.settled, 0, "a batch with a failed call is never settled");
    assert.equal((await h.app.request(path)).status, HTTP_PAYMENT_REQUIRED, "an unsettled batch can be paid again");

    h.failing.clear();
    const paid = await h.app.request(path, { headers: { "payment-signature": payment } });
    assert.equal(paid.status, HTTP_OK);
    const result = (await paid.json()) as { batchId: string; results: Array<{ id: string }> };
    assert.deepEqual(result.results.map((r) => r.id), ["openweather/current", "frankfurter/convert"]);
    assert.equal(h.settled, 1);

    const again = await h.app.request(path);
    assert.equal(again.status, HTTP_OK, "a settled batch answers its result, never another 402");
    assert.deepEqual(await again.json(), result);
    const replay = await h.app.request(path, { headers: { "payment-signature": payment } });
    assert.equal(replay.status, HTTP_OK);
    assert.equal(h.settled, 1, "a settled batch is never settled twice");
  });

  it("never runs a batch for an unpaid request, HEAD included", async () => {
    const created = await createBatch(h, [{ id: "openweather/current", input: { city: "Lagos" } }]);
    const head = await h.app.request(`/v2/batch/${created.body.batchId}`, { method: "HEAD" });
    assert.equal(head.status, HTTP_PAYMENT_REQUIRED);
    assert.equal(h.runs, 0);
  });

  it("stores nothing when an input doesn't fit or a tool is unknown", async () => {
    const invalid = await createBatch(h, [{ id: "openweather/current", input: { bad: true } }]);
    assert.equal(invalid.status, HTTP_UNPROCESSABLE);
    const unknown = await createBatch(h, [{ id: "nobody/nothing", input: {} }]);
    assert.equal(unknown.status, HTTP_NOT_FOUND);
  });
});
