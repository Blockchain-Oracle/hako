/**
 * The gateway routes the plugin calls, mirrored from packages/cards/src/contract/gateway/endpoints.ts
 * (`GATEWAY_ENDPOINTS`, the one wire contract): same keys, methods, paths and schemas. A route not in that table does
 * not exist, so the plugin never calls one that isn't here.
 */
import * as z from "zod/v4";

import {
  batchRequestSchema,
  batchResponseSchema,
  bridgeRequestSchema,
  bridgeStatusQuerySchema,
  bridgeStatusResponseSchema,
  earnMoveRequestSchema,
  idParamsSchema,
  invoiceCreateRequestSchema,
  invoiceDataSchema,
  proposalResponseSchema,
  quoteRequestSchema,
  routeDataSchema,
} from "./money.js";
import {
  chainBalanceRequestSchema,
  chainBlockRequestSchema,
  chainCallRequestSchema,
  chainGasRequestSchema,
  chainLogsRequestSchema,
  chainNameRequestSchema,
  chainTokenRequestSchema,
  chainTxRequestSchema,
  discoverRequestSchema,
  discoverResultSchema,
  earnPositionsRequestSchema,
  earnVaultsRequestSchema,
  inspectRequestSchema,
  marketsRequestSchema,
  runEnvelopeSchema,
  toolDocSchema,
} from "./reads.js";

export interface PluginEndpoint {
  method: "GET" | "POST";
  /** Express-style path: `:name` segments are filled from `params`, each one URL-encoded. */
  path: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
}

const alias = <B extends z.ZodType>(path: string, body: B) => ({ method: "POST", path, body, response: runEnvelopeSchema }) as const;

export const ENDPOINTS = {
  discover: { method: "POST", path: "/v1/discover", body: discoverRequestSchema, response: discoverResultSchema },
  inspect: { method: "POST", path: "/v1/inspect", body: inspectRequestSchema, response: toolDocSchema },
  batchCreate: { method: "POST", path: "/v1/batch", body: batchRequestSchema, response: batchResponseSchema },
  invoiceCreate: { method: "POST", path: "/v1/invoices", body: invoiceCreateRequestSchema, response: invoiceDataSchema },
  invoiceGet: { method: "GET", path: "/v1/invoices/:id", params: idParamsSchema, response: invoiceDataSchema },
  quote: { method: "POST", path: "/v1/quote", body: quoteRequestSchema, response: routeDataSchema },
  bridge: { method: "POST", path: "/v1/bridge", body: bridgeRequestSchema, response: proposalResponseSchema },
  bridgeStatus: { method: "GET", path: "/v1/bridge/status", query: bridgeStatusQuerySchema, response: bridgeStatusResponseSchema },
  earnDeposit: { method: "POST", path: "/v1/earn/deposit", body: earnMoveRequestSchema, response: proposalResponseSchema },
  earnWithdraw: { method: "POST", path: "/v1/earn/withdraw", body: earnMoveRequestSchema, response: proposalResponseSchema },
  chainBalance: alias("/v1/chain/balance", chainBalanceRequestSchema),
  chainToken: alias("/v1/chain/token", chainTokenRequestSchema),
  chainTx: alias("/v1/chain/tx", chainTxRequestSchema),
  chainBlock: alias("/v1/chain/block", chainBlockRequestSchema),
  chainGas: alias("/v1/chain/gas", chainGasRequestSchema),
  chainCall: alias("/v1/chain/call", chainCallRequestSchema),
  chainLogs: alias("/v1/chain/logs", chainLogsRequestSchema),
  chainName: alias("/v1/chain/name", chainNameRequestSchema),
  markets: alias("/v1/markets", marketsRequestSchema),
  earnVaults: alias("/v1/earn/vaults", earnVaultsRequestSchema),
  earnPositions: alias("/v1/earn/positions", earnPositionsRequestSchema),
} as const satisfies Record<string, PluginEndpoint>;

export type EndpointKey = keyof typeof ENDPOINTS;
type Def<K extends EndpointKey> = (typeof ENDPOINTS)[K];
type Field<D, F extends "params" | "query" | "body"> = D extends { [P in F]: infer S extends z.ZodType } ? { [P in F]: z.input<S> } : { [P in F]?: undefined };
export type EndpointRequest<K extends EndpointKey> = Field<Def<K>, "params"> & Field<Def<K>, "query"> & Field<Def<K>, "body">;
export type EndpointResponse<K extends EndpointKey> = z.output<Def<K>["response"]>;

/** Paid routes (x402 `exact`, Base USDC): the plugin proposes them for PayBox to pay, never calls them paid itself. */
export const PAID_PATHS = {
  run: (id: string) => `/v2/run/${id.split("/").map(encodeURIComponent).join("/")}`,
  batch: (batchId: string) => `/v2/batch/${encodeURIComponent(batchId)}`,
  invoice: (id: string) => `/v2/invoice/${encodeURIComponent(id)}`,
} as const;
