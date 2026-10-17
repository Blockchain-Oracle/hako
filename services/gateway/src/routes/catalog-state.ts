/**
 * The live catalog and the paid route table built from it. Until the api answers, the gateway serves health and
 * identity and the tool routes answer 503 (nothing to sell).
 */

import type { MiddlewareHandler } from "hono";

import { loadCatalog } from "../catalog.js";
import type { Catalog, CatalogEndpoint } from "../catalog.js";
import type { GatewayConfig } from "../config.js";
import { CATALOG_REFRESH_MS } from "../constants.js";
import { paymentLayer } from "../payments.js";

export interface CatalogState {
  catalog: Catalog | undefined;
  endpointsByPath: Map<string, CatalogEndpoint>;
  payments: MiddlewareHandler | undefined;
}

export const state: CatalogState = { catalog: undefined, endpointsByPath: new Map(), payments: undefined };

/** A new api deploy can add, remove or reprice tools: swap the catalog and the paid route table atomically. */
async function refreshCatalog(config: GatewayConfig, attempts?: number): Promise<void> {
  try {
    const next = await loadCatalog(config.apiUrl, attempts);
    if (next.hash === state.catalog?.hash) return;
    state.catalog = next;
    state.endpointsByPath = new Map(next.endpoints.filter((e) => e.available).map((e) => [e.path, e]));
    state.payments = config.mainnet ? paymentLayer(next, config.publicBaseUrl, config.mainnet) : undefined;
    console.log(JSON.stringify({ event: "catalog_loaded", hash: next.hash, endpoints: state.endpointsByPath.size }));
  } catch (error) {
    console.warn(JSON.stringify({ event: "catalog_load_failed", error: String(error) }));
  }
}

/** The first load retries for about a minute; the interval keeps trying after that. */
export function startCatalogRefresh(config: GatewayConfig): void {
  void refreshCatalog(config);
  setInterval(() => void refreshCatalog(config, 1), CATALOG_REFRESH_MS).unref();
}
