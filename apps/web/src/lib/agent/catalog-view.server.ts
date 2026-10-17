import "server-only";

import { getCatalog } from "@/lib/catalog/catalog.server";
import type { CatalogEndpoint } from "@/lib/catalog/types";
import { INPUT_FIELD_DESCRIPTION_CHARS } from "@/lib/constants/agent";

interface Property {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  anyOf?: Array<{ type?: string }>;
}

/** A schema the model can read in a few tokens: `field: type (required) — description`. */
export function compactInput(endpoint: CatalogEndpoint): Record<string, string> {
  const props = (endpoint.input.properties ?? {}) as Record<string, Property>;
  const required = new Set((endpoint.input.required as string[] | undefined) ?? []);
  return Object.fromEntries(
    Object.entries(props).map(([name, p]) => {
      const type = p.enum
        ? p.enum.map(String).join("|")
        : (p.type ?? (p.anyOf ?? []).map((a) => a.type).filter((t) => t && t !== "null").join("|")) || "any";
      const flags = required.has(name) ? " required" : p.default !== undefined ? ` default ${JSON.stringify(p.default)}` : "";
      const description = (p.description ?? "").slice(0, INPUT_FIELD_DESCRIPTION_CHARS);
      return [name, `${type}${flags}${description ? ` — ${description}` : ""}`];
    }),
  );
}

export async function endpointById(id: string): Promise<CatalogEndpoint | undefined> {
  return (await getCatalog()).endpoints.find((e) => e.id === id);
}
