import { z } from "zod";

import { invoiceDataSchema } from "../kinds/account.ts";
import { anyRunEnvelopeSchema, catalogSchema, discoverResultSchema, runEnvelopeSchema, toolDocSchema } from "../kinds/catalog.ts";
import { balanceDataSchema, blockDataSchema, chainNameDataSchema, contractReadDataSchema, gasDataSchema, logsDataSchema, tokenDataSchema, txReceiptDataSchema } from "../kinds/chain.ts";
import { marketDataSchema, positionsDataSchema, yieldDataSchema } from "../kinds/markets.ts";
import { rehearsalSchema, routeRaceDataSchema } from "../kinds/money.ts";
import { receiptDataSchema } from "../kinds/outcome.ts";
import { caip2Schema, jsonObjectSchema, urlSchema } from "../primitives.ts";
import {
  batchRequestSchema,
  batchResponseSchema,
  batchResultSchema,
  bridgeRequestSchema,
  bridgeStatusQuerySchema,
  bridgeStatusResponseSchema,
  broadcastRequestSchema,
  broadcastResponseSchema,
  earnMoveRequestSchema,
  idParamsSchema,
  invoiceCreateRequestSchema,
  proposalResponseSchema,
  quoteRequestSchema,
  quoteResponseSchema,
  receiptCreateRequestSchema,
  receiptsPageSchema,
  receiptsQuerySchema,
  rehearseRequestSchema,
  routesRequestSchema,
} from "./money-schemas.ts";
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
  earnPositionsRequestSchema,
  earnVaultsRequestSchema,
  inspectRequestSchema,
  logoQuerySchema,
  marketsRequestSchema,
  toolPathParamsSchema,
} from "./read-schemas.ts";

/**
 * The typed gateway endpoint table (plan W0.4, B12, B13): every route of `api.usehako.xyz` with its method, path, zod
 * request (path params, query, JSON body) and zod response. The gateway (L1) registers exactly these; the plugin, the
 * web server, the MCP tools and the CLI call them through `createGatewayClient`. A route not in this table does not
 * exist.
 */

export type HttpMethod = "GET" | "POST";
/** json: one JSON body. ndjson: one JSON snapshot per line (the route race). binary: bytes (audio, logos). */
export type ResponseType = "json" | "ndjson" | "binary";

export interface EndpointDef {
  method: HttpMethod;
  /** Express-style path: `:name` segments are filled from `params`, each one URL-encoded. */
  path: string;
  summary: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** The 2xx body: the whole JSON (json), one line (ndjson), or ignored (binary). */
  response: z.ZodType;
  responseType: ResponseType;
  /** x402 `exact` in USDC on Base: unpaid requests get a 402 with the price; PayBox pays it (`use_service`, plugin). */
  payment?: "x402";
  /** `hako`: needs the caller's Hako session (Better Auth JWT as a bearer). */
  auth: "none" | "hako";
}

const okSchema = z.object({ status: z.literal("ok") });
const noResponse = z.unknown();

export const GATEWAY_ENDPOINTS = {
  // Identity and the free catalog (served by hako-api through the gateway today).
  health: { method: "GET", path: "/v1/health", summary: "Readiness", response: okSchema, responseType: "json", auth: "none" },
  version: {
    method: "GET",
    path: "/v1/version",
    summary: "Gateway identity: catalog hash, endpoint count, x402 network and payTo",
    response: z.looseObject({
      service: z.string(),
      gateway: z.string(),
      catalog: z.string().nullable(),
      endpoints: z.number().int().min(0),
      network: caip2Schema.nullable(),
      payTo: z.string().nullable(),
    }),
    responseType: "json",
    auth: "none",
  },
  catalog: { method: "GET", path: "/v1/catalog", summary: "Every provider and tool with schemas and prices", response: catalogSchema, responseType: "json", auth: "none" },
  discover: {
    method: "POST",
    path: "/v1/discover",
    summary: "Rank the catalog for a job: price, health, p50/p95, hints",
    body: discoverRequestSchema,
    response: discoverResultSchema,
    responseType: "json",
    auth: "none",
  },
  inspect: { method: "POST", path: "/v1/inspect", summary: "One tool's whole contract", body: inspectRequestSchema, response: toolDocSchema, responseType: "json", auth: "none" },
  endpoint: {
    method: "GET",
    path: "/v1/endpoints/:provider/:slug",
    summary: "One tool's contract by path",
    params: toolPathParamsSchema,
    response: toolDocSchema,
    responseType: "json",
    auth: "none",
  },
  validate: {
    method: "POST",
    path: "/v1/validate/:provider/:slug",
    summary: "Check an input against a tool's schema (free, runs nothing; 422 with details when it does not fit)",
    params: toolPathParamsSchema,
    body: jsonObjectSchema,
    response: z.object({ valid: z.literal(true) }),
    responseType: "json",
    auth: "none",
  },
  x402Resources: {
    method: "GET",
    path: "/.well-known/x402",
    summary: "Every paid resource URL (x402 discovery)",
    response: z.object({ version: z.number().int(), resources: z.array(urlSchema) }),
    responseType: "json",
    auth: "none",
  },

  // Paid (B11, B12): x402 exact on Base USDC, 402 to every unpaid request, settled only on success.
  run: {
    method: "POST",
    path: "/v2/run/:provider/:slug",
    summary: "Run one catalog tool, paid per call",
    params: toolPathParamsSchema,
    body: jsonObjectSchema,
    response: anyRunEnvelopeSchema,
    responseType: "json",
    payment: "x402",
    auth: "none",
  },
  batchCreate: {
    method: "POST",
    path: "/v1/batch",
    summary: "Validate up to five calls, freeze their summed price, store them for 15 min (free)",
    body: batchRequestSchema,
    response: batchResponseSchema,
    responseType: "json",
    auth: "none",
  },
  batchPay: {
    method: "GET",
    path: "/v2/batch/:batchId",
    summary: "Pay a stored batch once; settles only if every call succeeds (404 when unknown or expired)",
    params: z.object({ batchId: z.string().min(1) }),
    response: batchResultSchema,
    responseType: "json",
    payment: "x402",
    auth: "none",
  },
  invoiceCreate: {
    method: "POST",
    path: "/v1/invoices",
    summary: "Create an open Base USDC invoice paid straight to payTo (free, rate-limited per IP)",
    body: invoiceCreateRequestSchema,
    response: invoiceDataSchema,
    responseType: "json",
    auth: "none",
  },
  invoiceGet: { method: "GET", path: "/v1/invoices/:id", summary: "An invoice's status: open or paid", params: idParamsSchema, response: invoiceDataSchema, responseType: "json", auth: "none" },
  invoicePay: {
    method: "GET",
    path: "/v2/invoice/:id",
    summary: "Pay an invoice (x402 to the payee); 404 when unknown; once claimed or paid, 200 with the paid invoice",
    params: idParamsSchema,
    response: invoiceDataSchema,
    responseType: "json",
    payment: "x402",
    auth: "none",
  },
  file: { method: "GET", path: "/v1/files/:id", summary: "Generated audio bytes stored by hako-api (24 h)", params: idParamsSchema, response: noResponse, responseType: "binary", auth: "none" },
  logo: { method: "GET", path: "/v1/logo", summary: "Allowlisted logo proxy (24 h cache)", query: logoQuerySchema, response: noResponse, responseType: "binary", auth: "none" },

  // Money (B13, L1).
  quote: {
    method: "POST",
    path: "/v1/quote",
    summary: "One LI.FI route (fees, ETA, min received) with its rehearsal line",
    body: quoteRequestSchema,
    response: quoteResponseSchema,
    responseType: "json",
    auth: "none",
  },
  routes: {
    method: "POST",
    path: "/v1/routes",
    summary: "The route race: one LI.FI /quote per contender bridge in parallel, streamed as snapshots",
    body: routesRequestSchema,
    response: routeRaceDataSchema,
    responseType: "ndjson",
    auth: "none",
  },
  bridge: {
    method: "POST",
    path: "/v1/bridge",
    summary: "The exact approve, or the R15-bound transfer from a fresh quote, or the new quote for review",
    body: bridgeRequestSchema,
    response: proposalResponseSchema,
    responseType: "json",
    auth: "none",
  },
  bridgeStatus: {
    method: "GET",
    path: "/v1/bridge/status",
    summary: "LI.FI status for a source transaction",
    query: bridgeStatusQuerySchema,
    response: bridgeStatusResponseSchema,
    responseType: "json",
    auth: "none",
  },
  earnDeposit: {
    method: "POST",
    path: "/v1/earn/deposit",
    summary: "LI.FI Earn deposit: exact approve first, then the bound deposit",
    body: earnMoveRequestSchema,
    response: proposalResponseSchema,
    responseType: "json",
    auth: "none",
  },
  earnWithdraw: {
    method: "POST",
    path: "/v1/earn/withdraw",
    summary: "LI.FI Earn withdraw: the share approve when the quote names a spender, then the bound withdraw",
    body: earnMoveRequestSchema,
    response: proposalResponseSchema,
    responseType: "json",
    auth: "none",
  },
  rehearse: {
    method: "POST",
    path: "/v1/rehearse",
    summary: "Simulate a draft version (eth_simulateV1 / simulateTransaction), cached by id:version",
    body: rehearseRequestSchema,
    response: rehearsalSchema,
    responseType: "json",
    auth: "none",
  },
  broadcast: {
    method: "POST",
    path: "/v1/broadcast",
    summary: "Send a PayBox-signed tx after checking it equals its draft version (the only sender of signed txs)",
    body: broadcastRequestSchema,
    response: broadcastResponseSchema,
    responseType: "json",
    auth: "none",
  },
  receipts: {
    method: "GET",
    path: "/v1/receipts",
    summary: "The caller's own receipts, newest first",
    query: receiptsQuerySchema,
    response: receiptsPageSchema,
    responseType: "json",
    auth: "hako",
  },
  receiptGet: { method: "GET", path: "/v1/receipts/:id", summary: "One receipt (the shared /r/<id> page)", params: idParamsSchema, response: receiptDataSchema, responseType: "json", auth: "none" },
  receiptCreate: {
    method: "POST",
    path: "/v1/receipts",
    summary: "Check a transaction on chain and record it as the caller's receipt",
    body: receiptCreateRequestSchema,
    response: receiptDataSchema,
    responseType: "json",
    auth: "hako",
  },

  // Free read aliases (B13 "Reads"): the body is the connector's input (READ_ALIAS_CONNECTORS names the connector by
  // chain family), the answer its run envelope.
  chainBalance: alias("/v1/chain/balance", "Balances of an address on one chain", chainBalanceRequestSchema, balanceDataSchema),
  chainToken: alias("/v1/chain/token", "One token's facts, by address or symbol", chainTokenRequestSchema, tokenDataSchema),
  chainTx: alias("/v1/chain/tx", "A transaction and its receipt", chainTxRequestSchema, txReceiptDataSchema),
  chainBlock: alias("/v1/chain/block", "A block (EVM)", chainBlockRequestSchema, blockDataSchema),
  chainGas: alias("/v1/chain/gas", "Fees right now", chainGasRequestSchema, gasDataSchema),
  chainCall: alias("/v1/chain/call", "A contract view call (EVM)", chainCallRequestSchema, contractReadDataSchema),
  chainLogs: alias("/v1/chain/logs", "Event logs in a block range (EVM)", chainLogsRequestSchema, logsDataSchema),
  chainName: alias("/v1/chain/name", "ENS / Basename lookup, forward or reverse", chainNameRequestSchema, chainNameDataSchema),
  markets: alias("/v1/markets", "Prediction-market odds and news for a question", marketsRequestSchema, marketDataSchema),
  earnVaults: alias("/v1/earn/vaults", "LI.FI Earn vaults by yield", earnVaultsRequestSchema, yieldDataSchema),
  earnPositions: alias("/v1/earn/positions", "An address's LI.FI Earn positions", earnPositionsRequestSchema, positionsDataSchema),
} as const satisfies Record<string, EndpointDef>;

function alias<B extends z.ZodType, D extends z.ZodType>(path: string, summary: string, body: B, data: D) {
  return { method: "POST", path, summary, body, response: runEnvelopeSchema(data), responseType: "json", auth: "none" } as const;
}

export type GatewayEndpoints = typeof GATEWAY_ENDPOINTS;
export type EndpointKey = keyof GatewayEndpoints;
export const ENDPOINT_KEYS = Object.keys(GATEWAY_ENDPOINTS) as EndpointKey[];
