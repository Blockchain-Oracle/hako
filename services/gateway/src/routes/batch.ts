/**
 * Batches (plan A4, B12): `POST /v1/batch` (free) validates every call, prices the set from the catalog, freezes the
 * sum and stores it for BATCH_TTL_S; `GET /v2/batch/<batchId>` (x402 `exact`) charges exactly that sum once, runs every
 * call and settles only if every call succeeded. Unknown or expired ids answer 404, never a 402; a settled batch
 * answers its stored result and never asks to be paid again.
 */

import type { Context, Hono } from "hono";
import type { z } from "zod";

import { endpointUrl } from "@hako/cards/client";
import { batchRequestSchema, type batchResponseSchema, type batchResultSchema, GATEWAY_ENDPOINTS } from "@hako/cards/contract";
import { BATCH_TTL_S, SECONDS_PER_MINUTE } from "@hako/config";
import { fromAtomic } from "@hako/money";
import { networkByCaip2, X402_NETWORK } from "@hako/networks";

import { HTTP_BAD_GATEWAY, HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_OK, HTTP_UNAVAILABLE, HTTP_UNPROCESSABLE } from "../constants.js";
import { jsonError } from "../errors.js";
import { batchStore, newBatch, priceCalls, runCalls, type StoredBatch } from "./x402/batch-store.js";
import type { X402Context } from "./x402/context.js";
import { refuse } from "./x402/http.js";
import { paidLayer, type PaidResource } from "./x402/paid.js";
import { HTTP_CONFLICT } from "./x402/x402.config.js";

type BatchResponse = z.input<typeof batchResponseSchema>;
type BatchResult = z.input<typeof batchResultSchema>;

const { batchCreate, batchPay } = GATEWAY_ENDPOINTS;

/** The api's own `{error: {message, details}}` words for a refused input, folded into one line. */
function refusalLine(index: number, id: string, body: string): string {
  try {
    const { error } = JSON.parse(body) as { error?: { message?: string; details?: string[] } };
    return [`calls[${index}] ${id}: ${error?.message ?? "input refused"}`, ...(error?.details ?? [])].join("; ");
  } catch {
    return `calls[${index}] ${id}: input refused`;
  }
}

export function registerBatch(app: Hono, ctx: X402Context): void {
  const decimals = (ctx.rail && networkByCaip2(ctx.rail.network)?.usdc.decimals) ?? X402_NETWORK.usdc.decimals;
  const usd = (atomic: string) => fromAtomic(BigInt(atomic), decimals);
  const store = ctx.kv ? batchStore(ctx.kv) : null;
  const storeMissing = (c: Context) =>
    jsonError(c, HTTP_UNAVAILABLE, "batch_store_unavailable", "Batches are not available on this gateway right now; nothing was charged.");

  const describe = (batch: StoredBatch): BatchResponse => ({
    batchId: batch.batchId,
    priceAtomic: batch.priceAtomic,
    priceUsd: usd(batch.priceAtomic),
    network: batch.network,
    expiresAt: batch.expiresAt,
    calls: batch.calls.map((call) => ({ id: call.id, priceAtomic: call.priceAtomic })),
    paidUrl: endpointUrl(ctx.publicBaseUrl, "batchPay", { params: { batchId: batch.batchId } }),
  });

  app.post(batchCreate.path, async (c) => {
    if (!ctx.rail) return jsonError(c, HTTP_NOT_FOUND, "mainnet_disabled", "Paid runs are not enabled on this gateway.");
    if (!store) return storeMissing(c);
    const endpoints = ctx.endpoints();
    if (!endpoints) return jsonError(c, HTTP_UNAVAILABLE, "catalog_unavailable", "The tool catalog has not loaded yet; nothing was stored.");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, HTTP_BAD_REQUEST, "invalid_json", "Request body is not valid JSON.");
    }
    const parsed = batchRequestSchema.safeParse(body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
      return refuse(c, HTTP_UNPROCESSABLE, "invalid_batch", "A batch is {calls: [{id, input}]} with one to five calls.", details);
    }
    const priced = priceCalls(parsed.data.calls, endpoints);
    if ("unknown" in priced) {
      return jsonError(c, HTTP_NOT_FOUND, "unknown_endpoint", `no tool ${priced.unknown.join(", ")} in the catalog; nothing was stored`,
        ["POST /v1/discover with {query} to find one"]);
    }
    // Every input is checked before anything is priced or stored (free; the paid run checks again).
    const checks = await Promise.all(priced.calls.map((call) => ctx.api.validate(call.id, JSON.stringify(call.input)).catch(() => null)));
    const refused: string[] = [];
    for (const [index, check] of checks.entries()) {
      const id = priced.calls[index]!.id;
      if (!check || (check.status !== HTTP_OK && check.status !== HTTP_BAD_REQUEST && check.status !== HTTP_UNPROCESSABLE)) {
        return jsonError(c, HTTP_BAD_GATEWAY, "api_unreachable", `The tool router could not check ${id}; nothing was stored.`);
      }
      if (check.status !== HTTP_OK) refused.push(refusalLine(index, id, check.body));
    }
    if (refused.length > 0) return refuse(c, HTTP_UNPROCESSABLE, "invalid_input", "Some calls don't fit their tool's input; nothing was stored.", refused);
    const batch = newBatch(priced.calls, priced.total, ctx.rail.network);
    await store.save(batch);
    return c.json(describe(batch));
  });

  const resource: PaidResource = {
    path: batchPay.path,
    description: "A batch of Hako tools, one payment for every call",
    async price({ batchId = "" }) {
      const batch = store ? await store.load(batchId) : null;
      if (!batch) throw new Error(`batch ${batchId} is unknown or expired`);
      return `$${usd(batch.priceAtomic)}`;
    },
    payTo: async () => ctx.rail!.payTo,
    async unpaidBody({ batchId = "" }) {
      const batch = store ? await store.load(batchId) : null;
      return batch ? describe(batch) : {};
    },
    claim: async ({ batchId = "" }) => ((await store!.claim(batchId)) ? null : "batch_already_paid"),
    async settled({ batchId = "" }, result, body) {
      if (body) await store!.saveResult(batchId, body.toString("utf8"));
      console.log(JSON.stringify({ event: "batch_settled", batchId, tx: result.transaction, payer: result.payer ?? null }));
    },
    release: ({ batchId = "" }) => store!.release(batchId),
  };

  app.get(
    batchPay.path,
    // Before any 402: a settled batch answers its result, an unknown or expired one 404, a settling one 409.
    async (c, next) => {
      if (!store) return storeMissing(c);
      const batchId = c.req.param("batchId") ?? "";
      const stored = await store.result(batchId);
      if (stored) return c.body(stored, HTTP_OK, { "content-type": "application/json" });
      if (!(await store.load(batchId))) {
        return jsonError(c, HTTP_NOT_FOUND, "unknown_batch", `no batch ${batchId}: unknown, or expired after ${BATCH_TTL_S / SECONDS_PER_MINUTE} minutes; nothing was charged`,
          [`POST ${batchCreate.path} again to price a new batch`]);
      }
      if (await store.claimed(batchId)) {
        return refuse(c, HTTP_CONFLICT, "batch_settling", "A payment for this batch is settling; ask again in a few seconds.");
      }
      await next();
    },
    paidLayer(ctx, resource),
    async (c) => {
      const batchId = c.req.param("batchId") ?? "";
      const batch = await store!.load(batchId);
      if (!batch) return jsonError(c, HTTP_NOT_FOUND, "unknown_batch", `batch ${batchId} expired before it ran; nothing was charged`);
      const { complete, outcomes } = await runCalls(batch.calls, ctx.api.run);
      if (!complete) {
        const failed = outcomes.filter((outcome) => !outcome.ok);
        return jsonError(c, HTTP_BAD_GATEWAY, "batch_incomplete",
          `${failed.length} of ${outcomes.length} calls failed, so nothing was charged; pay the same batch again to retry until ${batch.expiresAt}.`,
          failed.map((outcome) => `${outcome.id}: HTTP ${outcome.status || "unreachable"}`));
      }
      const result: BatchResult = { batchId, results: outcomes.map((outcome) => ({ id: outcome.id, envelope: outcome.envelope as BatchResult["results"][number]["envelope"] })) };
      return c.json(result);
    },
  );
}
