import "server-only";

import { getCatalog } from "@/lib/catalog/catalog.server";

import type { EndpointMeta } from "./endpoints-context";

/** The slice of the catalog the chat ships to the browser (no schemas: the server reads those). */
export async function chatEndpoints(): Promise<Record<string, EndpointMeta>> {
  const catalog = await getCatalog();
  return Object.fromEntries(
    catalog.endpoints
      .filter((e) => e.available)
      .map((e) => [
        e.id,
        { id: e.id, displayName: e.displayName, provider: e.provider, providerName: e.providerName, path: e.path, price: e.price, render: e.render },
      ]),
  );
}
