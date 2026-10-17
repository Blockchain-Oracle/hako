import { z } from "zod";

import { cardEnvelopeSchema } from "./envelope.ts";
import {
  activityDataSchema,
  contactDataSchema,
  fundDataSchema,
  invoiceDataSchema,
  limitDataSchema,
  passportDataSchema,
  portfolioDataSchema,
  receiveDataSchema,
} from "./kinds/account.ts";
import { catalogDataSchema, toolDataSchema } from "./kinds/catalog.ts";
import {
  balanceDataSchema,
  blockDataSchema,
  chainNameDataSchema,
  contractReadDataSchema,
  gasDataSchema,
  logsDataSchema,
  tokenDataSchema,
  txReceiptDataSchema,
} from "./kinds/chain.ts";
import {
  fxDataSchema,
  jsonDataSchema,
  packageDataSchema,
  placeDataSchema,
  quoteDataSchema,
  tableDataSchema,
  timeDataSchema,
  weatherDataSchema,
} from "./kinds/facts.ts";
import { audioDataSchema, marketDataSchema, modelBenchDataSchema, positionsDataSchema, yieldDataSchema } from "./kinds/markets.ts";
import {
  earnDraftDataSchema,
  payDataSchema,
  routeDataSchema,
  routeDraftDataSchema,
  routeRaceDataSchema,
  sendDraftDataSchema,
} from "./kinds/money.ts";
import { failureDataSchema, receiptDataSchema, statusDataSchema } from "./kinds/outcome.ts";
import {
  answerDataSchema,
  definitionDataSchema,
  jobsDataSchema,
  newsDataSchema,
  pageDataSchema,
  papersDataSchema,
  searchResultsDataSchema,
} from "./kinds/reading.ts";

/**
 * The card registry contract: every render kind → its data schema (plan §3 "Cards everywhere": registry
 * `kind → {zod schema, Card, Skeleton}`; L3 adds the components beside this). The schemas double as AI SDK and MCP
 * `outputSchema`s, and `pnpm --filter @hako/cards schemas` writes each one to `schemas/<kind>.json`.
 */

/**
 * Kinds a catalog tool's `render` may name: hako-api connectors return this `data` (the 15 existing kinds, the new
 * C18 data kinds, Earn positions and chain-name lookups). L2's gate validates every connector's sample output against
 * the generated JSON Schema of its kind.
 */
export const CATALOG_SCHEMAS = {
  search_results: searchResultsDataSchema,
  answer: answerDataSchema,
  page: pageDataSchema,
  papers: papersDataSchema,
  news: newsDataSchema,
  jobs: jobsDataSchema,
  quote: quoteDataSchema,
  fx: fxDataSchema,
  weather: weatherDataSchema,
  place: placeDataSchema,
  package: packageDataSchema,
  definition: definitionDataSchema,
  time: timeDataSchema,
  table: tableDataSchema,
  json: jsonDataSchema,
  market: marketDataSchema,
  audio: audioDataSchema,
  yield: yieldDataSchema,
  positions: positionsDataSchema,
  model_bench: modelBenchDataSchema,
  balance: balanceDataSchema,
  token: tokenDataSchema,
  tx_receipt: txReceiptDataSchema,
  block: blockDataSchema,
  gas: gasDataSchema,
  contract_read: contractReadDataSchema,
  logs: logsDataSchema,
  chain_name: chainNameDataSchema,
} as const;

/** Kinds Hako makes itself: money cards, outcomes, the account and the catalog cards. */
export const HAKO_SCHEMAS = {
  route: routeDataSchema,
  route_race: routeRaceDataSchema,
  pay: payDataSchema,
  send_draft: sendDraftDataSchema,
  swap_draft: routeDraftDataSchema,
  bridge_draft: routeDraftDataSchema,
  earn_deposit_draft: earnDraftDataSchema,
  earn_withdraw_draft: earnDraftDataSchema,
  status: statusDataSchema,
  receipt: receiptDataSchema,
  failure: failureDataSchema,
  invoice: invoiceDataSchema,
  activity: activityDataSchema,
  passport: passportDataSchema,
  contact: contactDataSchema,
  portfolio: portfolioDataSchema,
  receive: receiveDataSchema,
  fund: fundDataSchema,
  limit: limitDataSchema,
  catalog: catalogDataSchema,
  tool: toolDataSchema,
} as const;

export const CARD_SCHEMAS = { ...CATALOG_SCHEMAS, ...HAKO_SCHEMAS } as const;

export type CatalogRenderKind = keyof typeof CATALOG_SCHEMAS;
export type HakoCardKind = keyof typeof HAKO_SCHEMAS;
export type CardKind = keyof typeof CARD_SCHEMAS;

export const CATALOG_RENDER_KINDS = Object.keys(CATALOG_SCHEMAS) as CatalogRenderKind[];
export const HAKO_CARD_KINDS = Object.keys(HAKO_SCHEMAS) as HakoCardKind[];
export const CARD_KINDS = Object.keys(CARD_SCHEMAS) as CardKind[];
export const cardKindSchema = z.enum(CARD_KINDS as [CardKind, ...CardKind[]]);

/** Draft card kinds, one per money draft tool; `hako_draft_update` and `hako_refresh` answer with one of these. */
export const DRAFT_CARD_KINDS = ["send_draft", "swap_draft", "bridge_draft", "earn_deposit_draft", "earn_withdraw_draft"] as const satisfies readonly HakoCardKind[];
export type DraftCardKind = (typeof DRAFT_CARD_KINDS)[number];

/**
 * What a paid run or a money move turns into once it runs (plan §1 card flow steps 1, 3 and 4): its live status, the
 * failure card that says whether money moved, its receipt, the paid invoice, or the paid tool's result card (any catalog
 * kind, with the receipt line in `envelope.payment`). `hako_execute`, `hako_request_status` and `hako_broadcast`
 * answer with these.
 */
export const OUTCOME_CARD_KINDS = ["status", "failure", "receipt", "invoice", ...CATALOG_RENDER_KINDS] as const;
export type OutcomeCardKind = (typeof OUTCOME_CARD_KINDS)[number];

export type CardDataSchema<K extends CardKind> = (typeof CARD_SCHEMAS)[K];
export type CardData<K extends CardKind> = z.output<CardDataSchema<K>>;

export const isCardKind = (value: unknown): value is CardKind => typeof value === "string" && Object.hasOwn(CARD_SCHEMAS, value);
export const isCatalogRenderKind = (value: unknown): value is CatalogRenderKind =>
  typeof value === "string" && Object.hasOwn(CATALOG_SCHEMAS, value);

/** One kind's `structuredContent {kind, data, envelope}` schema: a tool's MCP `outputSchema` and AI SDK output. */
export function structuredContentSchema<K extends CardKind>(kind: K) {
  return z.object({ kind: z.literal(kind), data: CARD_SCHEMAS[kind] as CardDataSchema<K>, envelope: cardEnvelopeSchema });
}
export type StructuredContentSchema<K extends CardKind> = ReturnType<typeof structuredContentSchema<K>>;

export type StructuredContent<K extends CardKind = CardKind> = K extends CardKind ? z.output<StructuredContentSchema<K>> : never;

/** The schema of a tool that answers with one of several kinds: its output is exactly one of those cards. */
export type StructuredContentUnionSchema<K extends CardKind> = z.ZodType<StructuredContent<K>, unknown>;

/**
 * A tool that answers with one of several kinds (`hako_chain_read`, `hako_fund`, `hako_draft_update`, `hako_refresh`,
 * the execute outcomes). An object at the root, as MCP `inputSchema`/`outputSchema` and the model providers' tool
 * schemas require (`type: "object"`, no root `oneOf`): `kind` names the card, `data` lists the kinds' data schemas, and
 * a refinement checks `data` against the named kind's own schema and keeps that schema's parse, so a card can never
 * carry another kind's data. Put Hako's own kinds before catalog kinds: a union keeps its first match.
 */
export function structuredContentUnion<const K extends readonly [CardKind, ...CardKind[]]>(kinds: K): StructuredContentUnionSchema<K[number]> {
  const options = [...new Set(kinds.map((kind): z.ZodType => CARD_SCHEMAS[kind]))];
  const [first, ...rest] = options as [z.ZodType, ...z.ZodType[]];
  const data = rest.length === 0 ? first : z.union([first, ...rest]);
  const ownParse = (value: { kind: CardKind; data: unknown }) => CARD_SCHEMAS[value.kind].safeParse(value.data);
  const schema = z
    .object({ kind: z.enum(kinds), data, envelope: cardEnvelopeSchema })
    .superRefine((value, ctx) => {
      const parsed = ownParse(value);
      if (parsed.success) return;
      for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: ["data", ...issue.path], message: issue.message });
    })
    .overwrite((value) => {
      const parsed = ownParse(value);
      return parsed.success ? { ...value, data: parsed.data } : value;
    });
  return schema as unknown as StructuredContentUnionSchema<K[number]>;
}

/** Every card of every kind: what a surface reads back from a stored tool part before it knows the kind. */
export const anyStructuredContentSchema = z.discriminatedUnion(
  "kind",
  CARD_KINDS.map((kind) => structuredContentSchema(kind)) as unknown as [StructuredContentSchema<CardKind>, ...StructuredContentSchema<CardKind>[]],
);

/** What L3's components are registered against: one entry per kind (components arrive with L3). */
export interface CardRegistryEntry<K extends CardKind = CardKind> {
  kind: K;
  schema: CardDataSchema<K>;
  /** `catalog`: a hako-api connector's data; `hako`: a card Hako makes itself. */
  origin: K extends CatalogRenderKind ? "catalog" : "hako";
}
export type CardRegistry = { [K in CardKind]: CardRegistryEntry<K> };

export const CARD_REGISTRY = Object.fromEntries(
  CARD_KINDS.map((kind) => [kind, { kind, schema: CARD_SCHEMAS[kind], origin: isCatalogRenderKind(kind) ? "catalog" : "hako" }]),
) as unknown as CardRegistry;
