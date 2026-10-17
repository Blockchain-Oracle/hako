import "server-only";

import { CATALOG_REVALIDATE_S } from "@/lib/constants/site";
import { serverEnv } from "@/lib/server/env.server";

import type { Catalog, CatalogEndpoint, CatalogProvider } from "./types";

const EMPTY: Catalog = { service: "tool-router", hash: "", network: "", categories: [], providers: [], endpoints: [] };

/** The catalog from the api (cached by Next for CATALOG_REVALIDATE_S); an unreachable api renders an empty one. */
export async function getCatalog(): Promise<Catalog> {
  try {
    const res = await fetch(`${serverEnv().HAKO_API_URL}/v1/catalog`, {
      next: { revalidate: CATALOG_REVALIDATE_S, tags: ["catalog"] },
    });
    if (!res.ok) return EMPTY;
    return (await res.json()) as Catalog;
  } catch {
    return EMPTY;
  }
}

export async function getProvider(id: string): Promise<{ provider: CatalogProvider; endpoints: CatalogEndpoint[] } | null> {
  const catalog = await getCatalog();
  const provider = catalog.providers.find((p) => p.id === id);
  if (!provider) return null;
  return { provider, endpoints: catalog.endpoints.filter((e) => e.provider === id) };
}
