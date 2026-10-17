/** The catalog from the api: it decides which run routes exist and what each costs (re-read every minute). */

import { CATALOG_FETCH_TIMEOUT_MS, CATALOG_RETRY_ATTEMPTS, CATALOG_RETRY_DELAY_MS } from "./constants.js";

export interface EndpointPrice {
  usd: string;
  atomic: string;
  tier: string;
  network: string;
}

export interface CatalogEndpoint {
  id: string;
  provider: string;
  providerName: string;
  slug: string;
  displayName: string;
  summary: string;
  description: string;
  categories: string[];
  render: string;
  price: EndpointPrice;
  method: "POST";
  path: string;
  available: boolean;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  example: Record<string, unknown>;
}

export interface Catalog {
  service: string;
  hash: string;
  network: string;
  providers: Array<Record<string, unknown> & { id: string }>;
  endpoints: CatalogEndpoint[];
  categories: Array<{ id: string; label: string; endpointCount: number }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadCatalog(apiUrl: string, attempts = CATALOG_RETRY_ATTEMPTS): Promise<Catalog> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${apiUrl}/v1/catalog`, { signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS) });
      if (res.ok) return (await res.json()) as Catalog;
      lastError = new Error(`catalog HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(CATALOG_RETRY_DELAY_MS);
  }
  throw new Error(`could not load the catalog from ${apiUrl}: ${String(lastError)}`);
}
