/** Hako's catalog in PayBox: discover and inspect are free; a run is an x402 proposal PayBox pays in Base USDC. */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  BASE_CHAIN,
  DISCOVER_DEFAULT_LIMIT,
  DISCOVER_MAX_LIMIT,
  QUERY_MAX_CHARS,
  TOOL_ID_PATTERN,
} from "../constants.js";
import { paidUrl, postJson, preflightRun } from "../gateway.js";
import { proposeX402, x402OutputSchema } from "../paybox.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const toolId = z.string().regex(TOOL_ID_PATTERN).describe('Tool id from hako_discover, e.g. "openweather/current".');

type Price = { usd: string; atomic: string };
type Candidate = { id: string; displayName: string; summary: string; price: Price; health?: { status?: string } };
type Endpoint = Candidate & { input: unknown; example: unknown; notes?: string };

const candidateSchema = z.object({ id: z.string(), name: z.string(), summary: z.string(), priceUsd: z.string() }).strict();

export function registerCatalogTools(server: McpServer) {
  server.registerTool(
    "hako_discover",
    {
      title: "Find a Hako tool",
      description:
        "Free. Ranks Hako's paid tools (web search, research papers, news, weather, maps, FX, crypto prices, " +
        "GitHub and packages, AI answers and more) for a job. Then call hako_inspect for the input schema.",
      inputSchema: z.object({
        query: z.string().min(2).max(QUERY_MAX_CHARS).describe('What the tool should do, e.g. "weather in a city".'),
        limit: z.number().int().min(1).max(DISCOVER_MAX_LIMIT).optional(),
      }).strict(),
      outputSchema: z.object({ query: z.string(), candidates: z.array(candidateSchema) }).strict(),
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const found = await postJson<{ candidates: Candidate[] }>("/v1/discover", { query, limit: limit ?? DISCOVER_DEFAULT_LIMIT });
      const candidates = found.candidates.map((c) => ({ id: c.id, name: c.displayName, summary: c.summary, priceUsd: c.price.usd }));
      const text = candidates.length
        ? candidates.map((c) => `${c.id} ($${c.priceUsd}): ${c.summary}`).join("\n")
        : "No tool matched. Try other words.";
      return { content: [{ type: "text", text }], structuredContent: { query, candidates } };
    },
  );

  server.registerTool(
    "hako_inspect",
    {
      title: "Inspect a Hako tool",
      description:
        "Free. Returns a tool's input schema, a working example, its price and its paid URL. Pay either with " +
        "hako_run (one PayBox approval per call) or with PayBox's own use_service on the paid URL (your grant's mode).",
      inputSchema: z.object({ id: toolId }).strict(),
      outputSchema: z.object({
        id: z.string(), name: z.string(), summary: z.string(), priceUsd: z.string(),
        input: z.json(), example: z.json(), paidUrl: z.string(), howToPay: z.string(),
      }).strict(),
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const e = await postJson<Endpoint>("/v1/inspect", { id });
      const url = paidUrl(e.id);
      const howToPay =
        `hako_run with {id: "${e.id}", input} returns a ${BASE_CHAIN} USDC payment for PayBox to approve; ` +
        `or call use_service with url ${url}, method POST and the input as body.`;
      const out = {
        id: e.id, name: e.displayName, summary: e.summary, priceUsd: e.price.usd,
        input: e.input as z.infer<ReturnType<typeof z.json>>, example: e.example as z.infer<ReturnType<typeof z.json>>,
        paidUrl: url, howToPay,
      };
      return {
        content: [{ type: "text", text: `${e.id} costs $${e.price.usd}. Example input: ${JSON.stringify(e.example)}\n${howToPay}` }],
        structuredContent: out,
      };
    },
  );

  server.registerTool(
    "hako_run",
    {
      title: "Run a Hako tool (paid)",
      description:
        "Runs one Hako tool. Checks the input for free first, then returns a USDC payment on Base for the exact " +
        "price; PayBox asks the user to approve, pays, and returns the tool's answer. Errors and lookups that find " +
        "nothing are never charged.",
      inputSchema: z.object({
        id: toolId,
        input: z.record(z.string(), z.json()).describe("Arguments matching the tool's input schema (see hako_inspect)."),
      }).strict(),
      outputSchema: x402OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, input }) => {
      const { url, amount } = await preflightRun(id, input);
      const proposal = proposeX402({ chain: BASE_CHAIN, url, method: "POST", body: input, maxAmount: amount });
      return {
        ...proposal,
        content: [{ type: "text", text: `Pay ${Number(amount) / 1e6} USDC on Base to run ${id}. Approve in PayBox; the answer comes back with the request.` }],
      };
    },
  );
}
