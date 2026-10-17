/** The tool-router catalog as the api serves it (GET /v1/catalog); shared by server pages and client widgets. */

export interface Price {
  usd: string;
  atomic: string;
  tier: "local" | "standard" | "premium";
  network: string;
}

export interface Health {
  status: "healthy" | "stable" | "degraded" | "outage" | "unknown";
  runs: number;
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface CatalogProvider {
  id: string;
  displayName: string;
  summary: string;
  homepage: string;
  docsUrl: string | null;
  categories: string[];
  terms: string;
  licence: string | null;
  attribution: string | null;
  logoDomain: string;
  endpointCount: number;
  available: boolean;
}

export interface CatalogEndpoint {
  id: string;
  provider: string;
  providerName: string;
  slug: string;
  displayName: string;
  summary: string;
  description: string;
  notes: string[];
  seeAlso: string[];
  categories: string[];
  render: string;
  price: Price;
  method: "POST";
  path: string;
  available: boolean;
  deadlineMs: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  example: Record<string, unknown>;
}

export interface CatalogCategory {
  id: string;
  label: string;
  endpointCount: number;
}

export interface Catalog {
  service: string;
  hash: string;
  network: string;
  categories: CatalogCategory[];
  providers: CatalogProvider[];
  endpoints: CatalogEndpoint[];
}
