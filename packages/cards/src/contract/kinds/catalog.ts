import { z } from "zod";

import { sourceRefSchema } from "../envelope.ts";
import { caip2Schema, jsonObjectSchema, priceSchema, urlSchema } from "../primitives.ts";

/**
 * The catalog as hako-api serves it (hako_tools framework: `Endpoint.summary_doc()`, `Endpoint.doc()`, `discover()`,
 * `catalog.compiled()`, the engine's run envelope) and the two cards made from it: `catalog` (hako_discover's ranked
 * candidates, Monid parity: health, p50/p95, hints) and `tool` (hako_inspect: one tool's contract and how to pay it).
 * These are hako-api's camelCase JSON; objects stay loose so a new catalog field never breaks a reader.
 */

const text = z.string();

export const HEALTH_STATUSES = ["healthy", "stable", "degraded", "outage", "unknown"] as const;

/** A tool's measured health (hako_tools.framework.health verdict). */
export const toolHealthSchema = z.looseObject({
  status: z.enum(HEALTH_STATUSES),
  runs: z.number().int().min(0),
  successRate: z.number().nullable(),
  p50Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  lastOkAt: z.number().nullable().optional(),
});

/** One catalog tool's summary (`Endpoint.summary_doc()`). */
export const toolSummarySchema = z.looseObject({
  id: text,
  provider: text,
  providerName: text,
  slug: text,
  displayName: text,
  summary: text,
  categories: z.array(text),
  render: text,
  price: priceSchema,
  method: z.literal("POST"),
  /** The catalog key (`/v1/run/<id>`): an identifier, never a route that runs anything. */
  path: text,
  available: z.boolean(),
});

/** One tool's whole contract (`Endpoint.doc()`, `POST /v1/inspect`). */
export const toolDocSchema = toolSummarySchema.extend({
  description: text,
  notes: z.array(text),
  seeAlso: z.array(text),
  deadlineMs: z.number(),
  cacheTtlS: z.number().nullable(),
  terms: text,
  /** JSON Schemas of the tool's input and output. */
  input: jsonObjectSchema,
  output: jsonObjectSchema,
  example: jsonObjectSchema,
});

export const discoverCandidateSchema = toolSummarySchema.extend({
  score: z.number(),
  health: toolHealthSchema,
});

/** `POST /v1/discover`: ranked candidates for a job, with price, health and hints naming what to call next. */
export const discoverResultSchema = z.looseObject({
  query: text,
  count: z.number().int().min(0),
  candidates: z.array(discoverCandidateSchema),
  hints: z.array(text),
});

/** The `catalog` card: hako_discover's result as hako-api returns it. */
export const catalogDataSchema = discoverResultSchema;

/** The `tool` card: one tool's contract plus where it runs for money and how PayBox pays it. */
export const toolDataSchema = toolDocSchema.extend({
  /** `POST <gateway>/v2/run/<id>`; null when paid runs are off or the tool is unavailable (howToPay says which). */
  paidUrl: urlSchema.nullable(),
  howToPay: text,
});

export const providerDocSchema = z.looseObject({
  id: text,
  displayName: text,
  summary: text,
  homepage: text,
  categories: z.array(text),
  terms: text,
  endpointCount: z.number().int().min(0),
  available: z.boolean(),
  // hako-api writes null for a provider field it doesn't have (Provider.doc() is a plain dict).
  docsUrl: text.nullish(),
  licence: text.nullish(),
  attribution: text.nullish(),
  logoDomain: text.nullish(),
});

/** `GET /v1/catalog`: every provider and tool with schemas and prices, and a content hash. */
export const catalogSchema = z.looseObject({
  service: text,
  hash: text,
  network: caip2Schema,
  title: text.optional(),
  catalogVersion: z.number().int().optional(),
  categories: z.array(z.looseObject({ id: text, label: text, endpointCount: z.number().int().min(0) })),
  providers: z.array(providerDocSchema),
  endpoints: z.array(toolDocSchema),
});

/** A "nothing found" answer: data, not a sale (settles at zero; the gateway answers it 404 on `/v2`). */
export const notFoundDataSchema = z.looseObject({ found: z.literal(false), message: text });

/**
 * A tool run's envelope (hako_tools engine `_envelope`): safe metadata first, the provider's data last. `/v2/run/*`
 * and the gateway's free read aliases (`/v1/chain/*`, `/v1/markets`, `/v1/earn/{vaults,positions}`) answer with it;
 * `data` is the render kind's data, or `{found: false, message}`.
 */
export function runEnvelopeSchema<D extends z.ZodType>(data: D) {
  return z.looseObject({
    service: text,
    endpoint: text,
    provider: text,
    status: text,
    found: z.boolean(),
    billable: z.boolean(),
    cached: z.boolean(),
    as_of: text,
    elapsed_ms: z.number(),
    price: priceSchema.optional(),
    render: text,
    notes: z.array(text),
    sources: z.array(sourceRefSchema),
    data: z.union([data, notFoundDataSchema]),
  });
}

/** A run envelope whose data is not checked here (`/v2/run/<id>`: any render kind). */
export const anyRunEnvelopeSchema = runEnvelopeSchema(z.unknown());
export type RunEnvelope = z.output<typeof anyRunEnvelopeSchema>;
