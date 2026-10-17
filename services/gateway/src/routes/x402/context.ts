/**
 * What the batch, invoice, receipt, logo and file routes run on. `productionContext()` builds it once from the
 * gateway's config and environment; tests pass their own (a local facilitator, an in-memory store).
 */

import type { FacilitatorClient } from "@x402/core/server";

import { HAKO_AUTH_ISSUER } from "@hako/config";
import type { Pool } from "@hako/db/node";
import { loadGatewayEnv } from "@hako/env/node";

import type { CatalogEndpoint } from "../../catalog.js";
import { gatewayConfig } from "../../config.js";
import { RUN_PREFIX, VALIDATE_PREFIX } from "../../constants.js";
import { forwardRead, forwardRun, type Forwarded } from "../../forward.js";
import { mainnetFacilitator } from "../../payments.js";
import { state } from "../catalog-state.js";
import { gatewayPool } from "./db.js";
import { memoryStore, redisStore, type KvStore } from "./kv.js";
import { hakoSessions, type SessionReader } from "./session.js";
import { FILE_FORWARD_TIMEOUT_MS } from "./x402.config.js";

/** The paid rail: x402 `exact` in USDC through one facilitator (CDP on Base mainnet in production). */
export interface PaidRail {
  network: `${string}:${string}`;
  payTo: `0x${string}`;
  facilitator: FacilitatorClient;
}

/** hako-api, reached the way the rest of the gateway reaches it (src/forward.ts). */
export interface ApiForward {
  /** `POST /v1/validate/<provider>/<slug>`: 200 when the input fits, 400/422 with details when it doesn't. */
  validate(toolId: string, body: string): Promise<Forwarded>;
  /** `POST /v1/run/<provider>/<slug>`: the tool's run envelope. */
  run(toolId: string, body: string): Promise<Forwarded>;
  /** `GET /v1/files/<id>`: bytes hako-api stored (generated audio). */
  file(id: string): Promise<Response>;
}

export interface X402Context {
  publicBaseUrl: string;
  /** Undefined when the gateway has no CDP key: then no paid route exists at all (never a half-configured one). */
  rail: PaidRail | undefined;
  /** Batches, claims, rate limits, the logo cache. Null only in production without REDIS_URL (those routes answer 503). */
  kv: KvStore | null;
  /** @hako/db: invoices and receipts. Null without DATABASE_URL (those routes answer 503; receipts are only logged). */
  pool: Pool | null;
  /** The live catalog's tools by their /v1/run path; undefined until hako-api answered. */
  endpoints(): ReadonlyMap<string, CatalogEndpoint> | undefined;
  api: ApiForward;
  sessions: SessionReader;
  fetch: typeof fetch;
}

let current: X402Context | undefined;

export function productionContext(): X402Context {
  if (current) return current;
  const config = gatewayConfig();
  const env = loadGatewayEnv();
  const production = env.NODE_ENV === "production";
  if (!env.REDIS_URL) {
    console.warn(JSON.stringify({ event: "gateway_kv", store: production ? "none" : "memory", reason: "REDIS_URL is not set" }));
  }
  const mainnet = config.mainnet;
  current = {
    publicBaseUrl: config.publicBaseUrl,
    rail: mainnet ? { network: mainnet.network, payTo: mainnet.payTo, facilitator: mainnetFacilitator(mainnet) } : undefined,
    kv: env.REDIS_URL ? redisStore(env.REDIS_URL) : production ? null : memoryStore(),
    pool: gatewayPool(),
    endpoints: () => (state.catalog ? state.endpointsByPath : undefined),
    api: {
      validate: (toolId, body) => forwardRead(config, "POST", `${VALIDATE_PREFIX}/${toolId}`, body),
      run: (toolId, body) => forwardRun(config, `${RUN_PREFIX}/${toolId}`, body),
      file: (id) => fetch(`${config.apiUrl}/v1/files/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(FILE_FORWARD_TIMEOUT_MS) }),
    },
    sessions: hakoSessions(env.HAKO_AUTH_ISSUER ?? HAKO_AUTH_ISSUER),
    fetch: globalThis.fetch,
  };
  return current;
}
