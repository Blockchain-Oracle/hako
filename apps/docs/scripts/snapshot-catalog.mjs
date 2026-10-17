#!/usr/bin/env node
/**
 * Refreshes the catalog snapshot the Tools pages are built from (docs builds run in CI without API access), then
 * regenerates content/docs/tools.
 *
 *   node scripts/snapshot-catalog.mjs                          GET $HAKO_API_URL (or NEXT_PUBLIC_API_URL)/v1/catalog
 *   node scripts/snapshot-catalog.mjs https://api.usehako.xyz
 *   node scripts/snapshot-catalog.mjs --file /tmp/catalog.json  e.g. `uv run hako-tools catalog > /tmp/catalog.json`
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateTools } from "./generate-tools.mjs";

const DEFAULT_API_URL = "https://api.usehako.xyz";
const FETCH_TIMEOUT_MS = 15_000;
const SNAPSHOT = path.join(import.meta.dirname, "..", "content", "catalog.json");

async function fromApi(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/catalog`;
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return { source: url, catalog: await res.json() };
}

async function fromFile(file) {
  return { source: file, catalog: JSON.parse(await readFile(file, "utf8")) };
}

function check(catalog, source) {
  const ok = catalog?.service === "tool-router" && Array.isArray(catalog.endpoints) && Array.isArray(catalog.providers);
  if (!ok) throw new Error(`${source} did not return a tool-router catalog`);
}

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
const { source, catalog } =
  fileIndex === -1
    ? await fromApi(args[0] ?? process.env.HAKO_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL)
    : await fromFile(args[fileIndex + 1]);
check(catalog, source);
await writeFile(SNAPSHOT, `${JSON.stringify(catalog, null, 2)}\n`);
const result = await generateTools();
console.log(`snapshot: ${source} → content/catalog.json (catalog ${result.hash})`);
console.log(`tools: ${result.endpoints} endpoints, ${result.providers} provider pages`);
