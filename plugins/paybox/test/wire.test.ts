/**
 * The plugin's wire mirror equals the one wire contract (packages/cards/src/contract/gateway): for every route the
 * plugin calls, the same method and path, and request and response schemas that produce the same JSON Schema. Needs
 * the workspace install (the contract resolves the workspace's zod and @hako/config); on a plugin-only clone, where
 * the contract can't load, it is skipped and says so.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import * as z from "zod/v4";

import { ENDPOINTS, type PluginEndpoint } from "../src/wire/endpoints.js";
import { runEnvelopeSchema } from "../src/wire/reads.js";

const contractEntry = new URL("../../../packages/cards/src/contract/gateway/index.ts", import.meta.url);
const workspaceZod = new URL("../../../packages/cards/node_modules/zod/package.json", import.meta.url);
const installed = existsSync(fileURLToPath(workspaceZod));

type ContractEndpoint = { method: string; path: string; params?: unknown; query?: unknown; body?: unknown; response: unknown };
type JsonSchemaOf = (schema: unknown, options: { io: "input" | "output"; unrepresentable: "any" }) => unknown;

/** Each side's own zod turns its own schema into JSON Schema; equal JSON Schema = the same wire shape. */
const pluginJson = (schema: unknown, io: "input" | "output") => z.toJSONSchema(schema as z.ZodType, { io, unrepresentable: "any" });

/**
 * zod 4.6 (the workspace) writes a nullable primitive as `type: [t, "null"]` where zod 4.4 (the plugin) writes
 * `anyOf: [{type: t}, {type: "null"}]`: the same schema, spelled two ways. Normalised to the anyOf spelling. The two
 * releases also ship different regexes for the same `z.iso.datetime()`, so a date-time is compared by its format.
 */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const entries = Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, normalize(v)] as const);
  const object = Object.fromEntries(entries) as Record<string, unknown>;
  if (object.format === "date-time") delete object.pattern;
  const { type, ...rest } = object;
  if (Array.isArray(type)) return { anyOf: type.map((t) => (t === "null" ? { type: "null" } : { type: t, ...rest })) };
  return object;
}

/** An object's JSON Schema without one property (and the definitions only it used). */
function without(schema: unknown, name: string): unknown {
  const { properties, required, $defs: _defs, ...rest } = schema as { properties: Record<string, unknown>; required?: string[]; $defs?: unknown };
  const others = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== name));
  return { ...rest, properties: others, ...(required ? { required: required.filter((key) => key !== name) } : {}) };
}

/** Properties the mirror leaves out on purpose: the plugin has no drafts, so it never sends the quote's `draft`. */
const LEFT_OUT: Record<string, string> = { "quote.body": "draft" };

describe("wire mirror = packages/cards gateway contract", { skip: installed ? false : "workspace not installed (run pnpm install at the repo root)" }, () => {
  it("has the same method, path and schemas for every route the plugin calls", async () => {
    const contract = (await import(contractEntry.href)) as { GATEWAY_ENDPOINTS: Record<string, ContractEndpoint> };
    const workspace = (await import(new URL("../../../packages/cards/node_modules/zod/index.js", import.meta.url).href)) as { toJSONSchema: JsonSchemaOf };
    const contractJson = (schema: unknown, io: "input" | "output") => workspace.toJSONSchema(schema, { io, unrepresentable: "any" });
    for (const [key, mine] of Object.entries(ENDPOINTS) as Array<[string, PluginEndpoint]>) {
      const theirs = contract.GATEWAY_ENDPOINTS[key];
      assert.ok(theirs, `${key} is not in the contract`);
      assert.equal(mine.method, theirs.method, `${key} method`);
      assert.equal(mine.path, theirs.path, `${key} path`);
      for (const field of ["params", "query", "body", "response"] as const) {
        const io = field === "response" ? "output" : "input";
        assert.equal(Boolean(mine[field]), Boolean(theirs[field]), `${key}.${field} presence`);
        if (!mine[field]) continue;
        const ours: unknown = normalize(pluginJson(mine[field], io));
        let contracts: unknown = normalize(contractJson(theirs[field], io));
        const leftOut = LEFT_OUT[`${key}.${field}`];
        if (leftOut) contracts = without(contracts, leftOut);
        // Read aliases: the envelope is mirrored exactly; its `data` passes through (the cards contract checks each kind).
        if (field === "response" && mine.response === runEnvelopeSchema) {
          assert.deepEqual(without(ours, "data"), without(contracts, "data"), `${key}.response envelope`);
          continue;
        }
        assert.deepEqual(ours, contracts, `${key}.${field}`);
      }
    }
  });
});
