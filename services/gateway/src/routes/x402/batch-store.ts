/**
 * Batches (plan A4, B12): up to five catalog calls priced once from the catalog, frozen and stored for BATCH_TTL_S,
 * paid with one x402 payment and run all-or-nothing. Pure over the key-value store, so tests run it in memory.
 */

import { randomBytes } from "node:crypto";

import { BATCH_TTL_S, MS_PER_SECOND } from "@hako/config";
import { sumAtomic } from "@hako/money";
import type { Caip2 } from "@hako/networks";

import type { CatalogEndpoint } from "../../catalog.js";
import { HTTP_OK, RUN_PREFIX } from "../../constants.js";
import type { Forwarded } from "../../forward.js";
import type { KvStore } from "./kv.js";
import { BATCH_ID_BYTES, KV_PREFIX } from "./x402.config.js";

export interface BatchCall {
  id: string;
  input: Record<string, unknown>;
}

export interface StoredCall extends BatchCall {
  priceAtomic: string;
}

export interface StoredBatch {
  batchId: string;
  calls: StoredCall[];
  /** The frozen sum: what `GET /v2/batch/<batchId>` charges, whatever the catalog says later. */
  priceAtomic: string;
  network: Caip2;
  createdAt: string;
  expiresAt: string;
}

/** Each call priced from the live catalog, or the ids the catalog doesn't have. */
export function priceCalls(calls: readonly BatchCall[], endpoints: ReadonlyMap<string, CatalogEndpoint>): { calls: StoredCall[]; total: bigint } | { unknown: string[] } {
  const unknown = calls.filter((call) => !endpoints.get(`${RUN_PREFIX}/${call.id}`)).map((call) => call.id);
  if (unknown.length > 0) return { unknown };
  const priced = calls.map((call) => ({ ...call, priceAtomic: endpoints.get(`${RUN_PREFIX}/${call.id}`)!.price.atomic }));
  return { calls: priced, total: sumAtomic(priced.map((call) => BigInt(call.priceAtomic))) };
}

export const newBatchId = (): string => randomBytes(BATCH_ID_BYTES).toString("base64url");

export function newBatch(calls: StoredCall[], total: bigint, network: Caip2, now = Date.now()): StoredBatch {
  return {
    batchId: newBatchId(),
    calls,
    priceAtomic: total.toString(),
    network,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + BATCH_TTL_S * MS_PER_SECOND).toISOString(),
  };
}

/**
 * Where a batch lives: the batch (until it expires), its claim (taken by the one settlement allowed; kept as long as
 * the batch, so a settled batch can never be claimed again) and its result (what a settled batch answers from then on).
 */
export function batchStore(kv: KvStore) {
  const key = (batchId: string, part?: "claim" | "result") => `${KV_PREFIX}:batch:${batchId}${part ? `:${part}` : ""}`;
  return {
    save: (batch: StoredBatch) => kv.set(key(batch.batchId), JSON.stringify(batch), BATCH_TTL_S),
    async load(batchId: string): Promise<StoredBatch | null> {
      const text = await kv.get(key(batchId));
      return text ? (JSON.parse(text) as StoredBatch) : null;
    },
    claim: (batchId: string) => kv.setIfAbsent(key(batchId, "claim"), new Date().toISOString(), BATCH_TTL_S),
    claimed: async (batchId: string) => (await kv.get(key(batchId, "claim"))) !== null,
    release: (batchId: string) => kv.del(key(batchId, "claim")),
    saveResult: (batchId: string, body: string) => kv.set(key(batchId, "result"), body, BATCH_TTL_S),
    result: (batchId: string) => kv.get(key(batchId, "result")),
  };
}
export type BatchStore = ReturnType<typeof batchStore>;

export interface CallOutcome {
  id: string;
  ok: boolean;
  status: number;
  envelope: unknown;
}

/** A run counts only when the api answered 200 with a billable envelope (`billable: false` = "does not exist", 404). */
function outcomeOf(id: string, forwarded: Forwarded): CallOutcome {
  let envelope: unknown = null;
  try {
    envelope = JSON.parse(forwarded.body);
  } catch {
    return { id, ok: false, status: forwarded.status, envelope: null };
  }
  const billable = (envelope as { billable?: unknown } | null)?.billable !== false;
  return { id, ok: forwarded.status === HTTP_OK && billable, status: forwarded.status, envelope };
}

/** Runs every call in parallel. `complete` only when every one succeeded: anything less is not sold. */
export async function runCalls(calls: readonly BatchCall[], run: (toolId: string, body: string) => Promise<Forwarded>): Promise<{ complete: boolean; outcomes: CallOutcome[] }> {
  const outcomes = await Promise.all(
    calls.map(async (call) => {
      try {
        return outcomeOf(call.id, await run(call.id, JSON.stringify(call.input)));
      } catch (error) {
        return { id: call.id, ok: false, status: 0, envelope: { error: String(error) } };
      }
    }),
  );
  return { complete: outcomes.every((outcome) => outcome.ok), outcomes };
}
