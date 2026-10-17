/** Which Hako user is calling (receipts are a person's own): only a JWT from Hako's issuer, signed by its key, counts. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { paidFor } from "./settlement.js";
import { sessionReader } from "./session.js";

const ISSUER = "https://usehako.test/api/auth";
const ALG = "EdDSA";

async function keys() {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: ALG, kid: "k1" }] });
  const sign = (claims: { sub?: string; iss?: string }) => {
    const jwt = new SignJWT({}).setProtectedHeader({ alg: ALG, kid: "k1" }).setIssuedAt().setExpirationTime("5m");
    if (claims.sub) jwt.setSubject(claims.sub);
    return jwt.setIssuer(claims.iss ?? ISSUER).sign(privateKey);
  };
  return { jwks, sign };
}

describe("Hako sessions", () => {
  it("reads the user from a valid bearer, and tells a missing one from a bad one", async () => {
    const { jwks, sign } = await keys();
    const read = sessionReader(ISSUER, jwks);
    assert.deepEqual(await read(`Bearer ${await sign({ sub: "user-1" })}`), { status: "valid", userId: "user-1" });
    assert.deepEqual(await read(undefined), { status: "none" });
    assert.deepEqual(await read("Basic abc"), { status: "none" });
    assert.deepEqual(await read(`Bearer ${await sign({ sub: "user-1", iss: "https://elsewhere.test" })}`), { status: "invalid" });
    assert.deepEqual(await read(`Bearer ${await sign({})}`), { status: "invalid" });
    const other = await keys();
    assert.deepEqual(await read(`Bearer ${await other.sign({ sub: "user-1" })}`), { status: "invalid" });
  });
});

describe("what a settled payment bought", () => {
  it("reads the tool, batch or invoice back from the paid path", () => {
    assert.deepEqual(paidFor("/v2/run/openweather/current"), { toolId: "openweather/current", batchId: null, invoiceId: null });
    assert.deepEqual(paidFor("/v2/batch/abc_-1"), { toolId: null, batchId: "abc_-1", invoiceId: null });
    assert.deepEqual(paidFor("/v2/invoice/QP0ZykcJZttS"), { toolId: null, batchId: null, invoiceId: "QP0ZykcJZttS" });
    assert.equal(paidFor("/v1/catalog"), null);
    assert.equal(paidFor("/v2/batch/a/b"), null);
  });
});
