#!/usr/bin/env node
/**
 * Writes the Tools section (content/docs/tools) from the catalog snapshot (content/catalog.json): an overview and
 * one page per provider. The folder is generated whole, so a provider removed from the catalog loses its page.
 *
 *   node scripts/generate-tools.mjs        (pnpm tools:generate; also runs before every build)
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { overviewPage, providerPage } from "./lib/pages.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const SNAPSHOT = path.join(ROOT, "content", "catalog.json");
const TOOLS_DIR = path.join(ROOT, "content", "docs", "tools");
const PROVIDERS_DIR = path.join(TOOLS_DIR, "(providers)");

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export async function generateTools() {
  const catalog = JSON.parse(await readFile(SNAPSHOT, "utf8"));
  if (!Array.isArray(catalog.endpoints) || !Array.isArray(catalog.providers)) {
    throw new Error(`${SNAPSHOT} is not a catalog (expected providers[] and endpoints[])`);
  }
  const byProvider = new Map();
  for (const e of catalog.endpoints) byProvider.set(e.provider, [...(byProvider.get(e.provider) ?? []), e]);
  const ctx = {
    labels: new Map(catalog.categories.map((c) => [c.id, c.label])),
    byId: new Map(catalog.endpoints.map((e) => [e.id, e])),
  };
  const providers = catalog.providers.filter((p) => byProvider.has(p.id));

  await rm(TOOLS_DIR, { recursive: true, force: true });
  await mkdir(PROVIDERS_DIR, { recursive: true });
  await writeFile(path.join(TOOLS_DIR, "meta.json"), json({ title: "Tools", pages: ["index", "(providers)"] }));
  await writeFile(path.join(TOOLS_DIR, "index.mdx"), overviewPage(catalog, byProvider));
  await writeFile(
    path.join(PROVIDERS_DIR, "meta.json"),
    json({ title: "Providers", defaultOpen: false, pages: providers.map((p) => p.id) }),
  );
  for (const provider of providers) {
    const page = providerPage(provider, byProvider.get(provider.id), ctx);
    await writeFile(path.join(PROVIDERS_DIR, `${provider.id}.mdx`), page);
  }
  return { providers: providers.length, endpoints: catalog.endpoints.length, hash: catalog.hash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await generateTools();
  console.log(`tools: ${result.endpoints} endpoints, ${result.providers} provider pages (catalog ${result.hash})`);
}
