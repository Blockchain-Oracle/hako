/**
 * The free reads' bodies, mirrored from packages/cards/src/contract/gateway/read-schemas.ts and kinds/catalog.ts (the
 * one wire contract). Alias bodies ARE the connector's input, so they are snake_case like every connector input.
 * Change both together.
 */
import * as z from "zod/v4";

import { caip2Schema, jsonObjectSchema, priceSchema } from "./primitives.js";
import {
  CONTRACT_ARGS_MAX,
  DISCOVER_LIMIT_DEFAULT,
  DISCOVER_LIMIT_MAX,
  DISCOVER_QUERY_MAX_CHARS,
  MARKET_QUERY_MAX_CHARS,
  MARKETS_LIMIT_DEFAULT,
  MARKETS_LIMIT_MAX,
  TOOL_ID_MAX_CHARS,
  VAULTS_LIMIT_DEFAULT,
  VAULTS_LIMIT_MAX,
} from "./wire.config.js";

const text = z.string();

/** `POST /v1/discover`. */
export const discoverRequestSchema = z.object({
  query: z.string().min(1).max(DISCOVER_QUERY_MAX_CHARS),
  category: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(DISCOVER_LIMIT_MAX).default(DISCOVER_LIMIT_DEFAULT),
  include_unavailable: z.boolean().optional(),
});

/** A catalog id: `<provider>/<slug>` (`wikipedia/summary`). */
export const toolIdSchema = z
  .string()
  .min(1)
  .max(TOOL_ID_MAX_CHARS)
  .regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, "a catalog id like wikipedia/summary");

/** `POST /v1/inspect`. */
export const inspectRequestSchema = z.object({ id: toolIdSchema });

export const toolHealthSchema = z.looseObject({
  status: z.enum(["healthy", "stable", "degraded", "outage", "unknown"]),
  runs: z.number().int().min(0),
  successRate: z.number().nullable(),
  p50Ms: z.number().nullable(),
  p95Ms: z.number().nullable(),
  lastOkAt: z.number().nullable().optional(),
});

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
  path: text,
  available: z.boolean(),
});

/** `POST /v1/inspect`: one tool's whole contract. */
export const toolDocSchema = toolSummarySchema.extend({
  description: text,
  notes: z.array(text),
  seeAlso: z.array(text),
  deadlineMs: z.number(),
  cacheTtlS: z.number().nullable(),
  terms: text,
  input: jsonObjectSchema,
  output: jsonObjectSchema,
  example: jsonObjectSchema,
});

/** `POST /v1/discover`: ranked candidates with price, health and hints. */
export const discoverResultSchema = z.looseObject({
  query: text,
  count: z.number().int().min(0),
  candidates: z.array(toolSummarySchema.extend({ score: z.number(), health: toolHealthSchema })),
  hints: z.array(text),
});

const blockTagSchema = z.union([z.number().int().min(0), z.literal("latest")]);

export const chainBalanceRequestSchema = z.object({ chain: caip2Schema, address: z.string().min(1), tokens: z.array(z.string().min(1)).optional() });
export const chainTokenRequestSchema = z.object({ chain: caip2Schema, token: z.string().min(1) });
export const chainTxRequestSchema = z.object({ chain: caip2Schema, hash: z.string().min(1) });
export const chainBlockRequestSchema = z.object({ chain: caip2Schema, block: blockTagSchema.optional() });
export const chainGasRequestSchema = z.object({ chain: caip2Schema });
export const chainCallRequestSchema = z.object({
  chain: caip2Schema,
  address: z.string().min(1),
  function: z.string().min(1),
  args: z.array(z.unknown()).max(CONTRACT_ARGS_MAX).default([]),
  block: blockTagSchema.optional(),
});
export const chainLogsRequestSchema = z.object({
  chain: caip2Schema,
  address: z.string().min(1).optional(),
  event: z.string().min(1).optional(),
  topics: z.array(z.string().nullable()).optional(),
  from_block: blockTagSchema,
  to_block: blockTagSchema.optional(),
});
export const chainNameRequestSchema = z.union([
  z.object({ chain: caip2Schema, name: z.string().min(1) }),
  z.object({ chain: caip2Schema, address: z.string().min(1) }),
]);

/** `POST /v1/markets`. */
export const marketsRequestSchema = z.object({
  query: z.string().min(1).max(MARKET_QUERY_MAX_CHARS),
  limit: z.number().int().min(1).max(MARKETS_LIMIT_MAX).default(MARKETS_LIMIT_DEFAULT),
  provider: z.string().min(1).optional(),
});

/** `POST /v1/earn/vaults`. */
export const earnVaultsRequestSchema = z.object({
  chain: caip2Schema.optional(),
  token: z.string().min(1).optional(),
  sort: z.enum(["apy", "tvl"]).default("apy"),
  limit: z.number().int().min(1).max(VAULTS_LIMIT_MAX).default(VAULTS_LIMIT_DEFAULT),
});

/** `POST /v1/earn/positions`. */
export const earnPositionsRequestSchema = z.object({ address: z.string().min(1), chain: caip2Schema.optional() });

const sourceRefSchema = z.looseObject({
  name: text,
  status: text.optional(),
  url: text.optional(),
  licence: text.optional(),
  attribution: text.optional(),
  as_of: text.optional(),
});

/**
 * kinds/catalog.ts `runEnvelopeSchema`: a tool run's envelope, safe metadata first, the connector's data last. The
 * read aliases answer with it; `data` is the render kind's data (checked by the cards contract, passed through here) or
 * `{found: false, message}`.
 */
export const runEnvelopeSchema = z.looseObject({
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
  data: z.json(),
});
export type RunEnvelope = z.output<typeof runEnvelopeSchema>;
