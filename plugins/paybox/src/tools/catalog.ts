/**
 * Hako's catalog in PayBox (plan §1 A1–A4): discover and inspect are free; a run, or a batch of up to five, is an x402
 * proposal PayBox pays in Base USDC with one approval.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { X402_RAIL } from "../constants.js";
import { guarded, HakoError } from "../errors.js";
import { callGateway, paidBatchUrl, paidRunUrl, preflightRun } from "../gateway.js";
import { proposeX402, x402OutputSchema } from "../paybox.js";
import { amountText, proposalExpiry } from "../proposals.js";
import { BATCH_MAX_CALLS } from "../shared.js";
import { jsonObjectSchema } from "../wire/primitives.js";
import { discoverRequestSchema, toolIdSchema } from "../wire/reads.js";
import { READ_ONLY, PAYS } from "./annotations.js";

const toolId = toolIdSchema.describe('Tool id from hako_discover, e.g. "openweather/current".');
/** A tool input is JSON (it becomes the paid request's body): the wire's JSON object, held to JSON values. */
const toolInput = z.record(z.string(), z.json()).describe("Arguments matching the tool's input schema (see hako_inspect).");

const candidateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    summary: z.string(),
    priceUsd: z.string(),
    priceAtomic: z.string(),
    available: z.boolean(),
    health: z.string(),
    successRate: z.number().nullable(),
    p50Ms: z.number().nullable(),
    p95Ms: z.number().nullable(),
  })
  .strict();

const usdc = (atomic: string) => amountText(atomic, X402_RAIL.decimals, X402_RAIL.symbol);

export function registerCatalogTools(server: McpServer) {
  server.registerTool(
    "hako_discover",
    {
      title: "Find a Hako tool",
      description:
        "Free. Ranks Hako's 80+ paid tools (web search, research papers, news, weather, maps, FX, crypto prices, " +
        "GitHub and packages, AI answers, media and more) for a job, with each tool's price, measured health and " +
        "p50/p95 latency, plus hints on what to call next. Then call hako_inspect for the input schema.",
      inputSchema: z
        .object({
          query: discoverRequestSchema.shape.query.describe('What the tool should do, e.g. "weather in a city".'),
          category: discoverRequestSchema.shape.category,
          limit: discoverRequestSchema.shape.limit.unwrap().optional(),
        })
        .strict(),
      outputSchema: z.object({ query: z.string(), count: z.number().int(), candidates: z.array(candidateSchema), hints: z.array(z.string()) }).strict(),
      annotations: READ_ONLY,
    },
    guarded(async ({ query, category, limit }) => {
      const found = await callGateway("discover", { body: { query, category, limit } });
      const candidates = found.candidates.map((c) => ({
        id: c.id,
        name: c.displayName,
        summary: c.summary,
        priceUsd: c.price.usd,
        priceAtomic: c.price.atomic,
        available: c.available,
        health: c.health.status,
        successRate: c.health.successRate,
        p50Ms: c.health.p50Ms,
        p95Ms: c.health.p95Ms,
      }));
      const lines = candidates.map(
        (c) => `${c.id} ($${c.priceUsd}, ${c.health}${c.p50Ms !== null ? `, p50 ${c.p50Ms} ms` : ""}${c.available ? "" : ", unavailable"}): ${c.summary}`,
      );
      const text = candidates.length ? [...lines, ...found.hints].join("\n") : "No tool matched. Try other words.";
      return { content: [{ type: "text" as const, text }], structuredContent: { query, count: found.count, candidates, hints: found.hints } };
    }),
  );

  server.registerTool(
    "hako_inspect",
    {
      title: "Inspect a Hako tool",
      description:
        "Free. Returns a tool's input schema, a working example, its price and its paid URL. Pay either with " +
        "hako_run (one PayBox approval per call), hako_run_batch (up to five tools, one approval) or PayBox's own " +
        "use_service on the paid URL (your grant's mode).",
      inputSchema: z.object({ id: toolId }).strict(),
      outputSchema: z
        .object({
          id: z.string(),
          name: z.string(),
          summary: z.string(),
          description: z.string(),
          priceUsd: z.string(),
          priceAtomic: z.string(),
          available: z.boolean(),
          input: jsonObjectSchema,
          example: jsonObjectSchema,
          notes: z.array(z.string()),
          paidUrl: z.string(),
          howToPay: z.string(),
        })
        .strict(),
      annotations: READ_ONLY,
    },
    guarded(async ({ id }) => {
      const doc = await callGateway("inspect", { body: { id } });
      const url = paidRunUrl(doc.id);
      const howToPay =
        `hako_run with {id: "${doc.id}", input} returns a ${X402_RAIL.chain} USDC payment for PayBox to approve; ` +
        `or call use_service with url ${url}, method POST and the input as body.`;
      const out = {
        id: doc.id,
        name: doc.displayName,
        summary: doc.summary,
        description: doc.description,
        priceUsd: doc.price.usd,
        priceAtomic: doc.price.atomic,
        available: doc.available,
        input: doc.input,
        example: doc.example,
        notes: doc.notes,
        paidUrl: url,
        howToPay,
      };
      return {
        content: [{ type: "text" as const, text: `${doc.id} costs $${doc.price.usd}. Example input: ${JSON.stringify(doc.example)}\n${howToPay}` }],
        structuredContent: out,
      };
    }),
  );

  server.registerTool(
    "hako_run",
    {
      title: "Run a Hako tool (paid)",
      description:
        "Runs one Hako tool. Checks the input for free first, then returns a USDC payment on Base for the exact " +
        "price; PayBox asks the person to approve, pays, and returns the tool's answer with the request. Errors and " +
        "lookups that find nothing are never charged. Follow the request id with get_request; never re-run to finish it.",
      inputSchema: z.object({ id: toolId, input: toolInput }).strict(),
      outputSchema: x402OutputSchema,
      annotations: PAYS,
    },
    guarded(async ({ id, input }) => {
      const { url, amountAtomic } = await preflightRun(id, input);
      const proposal = proposeX402({ chain: X402_RAIL.chain, url, method: "POST", body: input, maxAmount: amountAtomic });
      const text = `Pay ${usdc(amountAtomic)} on Base to run ${id}. Approve in PayBox; the answer comes back with the request.`;
      return { ...proposal, content: [{ type: "text" as const, text }] };
    }),
  );

  server.registerTool(
    "hako_run_batch",
    {
      title: "Run up to five Hako tools (one payment)",
      description:
        `Runs up to ${BATCH_MAX_CALLS} Hako tools with one USDC payment on Base and one PayBox approval. Every input is ` +
        "checked for free first and the summed price is frozen; the payment settles only if every call succeeds, and " +
        "all answers come back together with the request. Follow the request id with get_request; never re-run to finish it.",
      inputSchema: z
        .object({ calls: z.array(z.object({ id: toolId, input: toolInput }).strict()).min(1).max(BATCH_MAX_CALLS) })
        .strict(),
      outputSchema: x402OutputSchema,
      annotations: PAYS,
    },
    guarded(async ({ calls }) => {
      const batch = await callGateway("batchCreate", { body: { calls } });
      if (batch.network !== X402_RAIL.chain) throw new HakoError("gateway_contract_mismatch", `The batch is priced on ${batch.network}, not Base.`);
      if (!/^[1-9][0-9]*$/.test(batch.priceAtomic)) throw new HakoError("nothing_to_pay", "The batch costs nothing, so there is no payment to propose.");
      const url = paidBatchUrl(batch.batchId);
      const proposal = proposeX402({ chain: X402_RAIL.chain, url, method: "GET", maxAmount: batch.priceAtomic, expiresAt: proposalExpiry(batch.expiresAt) });
      const text =
        `Pay ${usdc(batch.priceAtomic)} on Base once for ${batch.calls.length} tools (${batch.calls.map((c) => c.id).join(", ")}). ` +
        "One approval in PayBox; it settles only if every call succeeds, and the answers come back together with the request.";
      return { ...proposal, content: [{ type: "text" as const, text }] };
    }),
  );
}
