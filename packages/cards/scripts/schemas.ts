/**
 * `pnpm --filter @hako/cards schemas`: writes one JSON Schema per render kind to `schemas/<kind>.json` (zod's JSON
 * Schema export of the kind's `data` schema, draft 2020-12, output shape) plus `schemas/index.json` naming each kind
 * and whether a catalog connector or Hako makes it. L2's gate validates every connector's sample output against its
 * kind's file. `--check` writes nothing and fails when a committed file differs from what the contract generates.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { CARD_KINDS, CARD_SCHEMAS, isCatalogRenderKind } from "../src/contract/registry.ts";

const OUT_DIR = path.join(import.meta.dirname, "..", "schemas");
const SCHEMA_BASE_URI = "https://usehako.xyz/schemas/cards";
const JSON_INDENT = 2;
const INDEX_FILE = "index.json";

const asJson = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT)}\n`;

function generate(): Map<string, string> {
  const files = new Map<string, string>();
  for (const kind of CARD_KINDS) {
    const schema = z.toJSONSchema(CARD_SCHEMAS[kind], { target: "draft-2020-12", io: "output", unrepresentable: "any" });
    files.set(`${kind}.json`, asJson({ $id: `${SCHEMA_BASE_URI}/${kind}.json`, title: kind, ...schema }));
  }
  const index = CARD_KINDS.map((kind) => ({ kind, file: `${kind}.json`, origin: isCatalogRenderKind(kind) ? "catalog" : "hako" }));
  files.set(INDEX_FILE, asJson({ kinds: index }));
  return files;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const files = generate();
  await mkdir(OUT_DIR, { recursive: true });
  const existing = new Set((await readdir(OUT_DIR)).filter((name) => name.endsWith(".json")));
  const stale: string[] = [];
  for (const [name, content] of files) {
    const current = existing.has(name) ? await readFile(path.join(OUT_DIR, name), "utf8") : null;
    if (current === content) continue;
    if (check) stale.push(name);
    else await writeFile(path.join(OUT_DIR, name), content);
  }
  for (const name of existing) {
    if (files.has(name)) continue;
    if (check) stale.push(name);
    else await rm(path.join(OUT_DIR, name));
  }
  if (check && stale.length > 0) {
    console.error(`schemas/ is out of date (${stale.join(", ")}): run pnpm --filter @hako/cards schemas`);
    process.exitCode = 1;
    return;
  }
  console.log(`${check ? "checked" : "wrote"} ${files.size} schema files in ${path.relative(process.cwd(), OUT_DIR) || "."}`);
}

await main();
