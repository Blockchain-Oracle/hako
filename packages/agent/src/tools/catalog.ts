import { type EndpointResponse, GatewayError } from "@hako/cards/client";
import {
  DISCOVER_LIMIT_DEFAULT,
  DISCOVER_LIMIT_MAX,
  DISCOVER_QUERY_MAX_CHARS,
  intentStateToPhase,
  jsonObjectSchema,
  type StructuredContent,
  structuredContentSchema,
  toolIdSchema,
} from "@hako/cards/contract";
import { networkByCaip2 } from "@hako/networks";
import type { DraftView } from "@hako/paybox";
import { z } from "zod";

import { HTTP_BAD_REQUEST, HTTP_UNPROCESSABLE } from "../agent.config.ts";
import { card, chip, defineTool, DRAFT, MODEL_AND_APP, READ } from "../define.ts";
import type { AgentDeps } from "../deps.ts";
import type { DraftLive } from "../draft-cards.ts";
import { AgentToolError, invalidInput } from "../errors.ts";

/** The catalog verbs (Monid parity): discover and inspect are free; run returns a pay card and pays nothing. */

export const hakoDiscover = defineTool({
  name: "hako_discover",
  title: "Find a Hako tool",
  description:
    "Free. Ranks Hako's catalog of 80+ paid tools (web search, page reading, cited answers, papers, news, weather, maps, " +
    "crypto and FX, GitHub and packages, time, dictionaries, audio, model benchmarks, chain reads…) for a job in plain " +
    "words. Returns ids, prices, measured health (p50/p95) and hints. Call hako_inspect next, then hako_run.",
  input: z.object({
    query: z.string().min(1).max(DISCOVER_QUERY_MAX_CHARS).describe("The job, e.g. 'weather in Lagos' or 'recent papers on RAG'"),
    limit: z.number().int().min(1).max(DISCOVER_LIMIT_MAX).default(DISCOVER_LIMIT_DEFAULT),
    category: z.string().min(1).optional().describe("A catalog category id such as web-search, crypto or weather"),
  }),
  output: structuredContentSchema("catalog"),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["catalog"],
  async execute(input, deps) {
    const result = await deps.gateway.call("discover", { body: input });
    const top = result.candidates[0];
    const suggestions = top ? [chip(`Use ${top.displayName}`, `Run ${top.id} for: ${input.query}`)] : [];
    return card("catalog", result, { phase: "result", suggestions }, deps);
  },
});

export const hakoInspect = defineTool({
  name: "hako_inspect",
  title: "Inspect a Hako tool",
  description:
    "Free. One tool's contract: what it does, its input JSON Schema, output schema, exact price and a working example, " +
    "plus the paid URL and how PayBox pays it. Use the example's field names when you call hako_run.",
  input: z.object({ id: toolIdSchema.describe("A catalog id from hako_discover, e.g. wikipedia/summary") }),
  output: structuredContentSchema("tool"),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["tool"],
  async execute({ id }, deps) {
    const doc = await deps.gateway.call("inspect", { body: { id } });
    const paidUrl = doc.available ? deps.gateway.url("run", { params: { provider: doc.provider, slug: doc.slug } }) : null;
    const howToPay = paidUrl
      ? `Paid per call: $${doc.price.usd} in USDC on Base (${doc.price.network}) from your PayBox wallet. hako_run makes a pay card; ` +
        `any PayBox agent can also call PayBox's use_service with url ${paidUrl}, method POST and the input as body.`
      : "This tool is unavailable right now, so nothing can be paid for it.";
    return card("tool", { ...doc, paidUrl, howToPay }, { phase: "result" }, deps);
  },
});

export const hakoRun = defineTool({
  name: "hako_run",
  title: "Run a Hako tool",
  description:
    "Prepares one paid tool run and shows a pay card with the tool, its provider and its exact price. Nothing is paid " +
    "here: the person taps Pay on the card, PayBox asks for their approval, and the result card replaces it. Checks the " +
    "input first (free), so a call that cannot run is never offered for payment.",
  input: z.object({
    id: toolIdSchema.describe("The catalog id, exactly as hako_discover returned it"),
    input: jsonObjectSchema.describe("The tool's input as a JSON object, using only the fields its schema lists"),
  }),
  output: structuredContentSchema("pay"),
  annotations: DRAFT,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["pay"],
  async execute({ id, input }, deps) {
    const doc = await deps.gateway.call("inspect", { body: { id } });
    if (!doc.available) throw new AgentToolError("tool_unavailable", `${doc.displayName} is unavailable right now; nothing was offered for payment.`);
    const params = { provider: doc.provider, slug: doc.slug };
    try {
      await deps.gateway.call("validate", { params, body: input });
    } catch (error) {
      if (error instanceof GatewayError && (error.status === HTTP_UNPROCESSABLE || error.status === HTTP_BAD_REQUEST)) {
        throw invalidInput(`${id} can't run with that input: ${[error.message, ...error.details].join("; ")}`);
      }
      throw error;
    }
    if (!networkByCaip2(doc.price.network)) throw new AgentToolError("unsupported", `${id} is priced on ${doc.price.network}, which Hako can't pay on.`);
    const view = await deps.intents.createDraft("run", { toolId: doc.id, input, priceAtomic: doc.price.atomic });
    return payCard(deps, doc, view);
  },
});

type ToolDoc = EndpointResponse<"inspect">;

/**
 * A run draft's pay card: the tool from the catalog, the price frozen on the draft version (what PayBox will pay),
 * and the `/v2` URL PayBox pays. Used by hako_run and by hako_refresh when a stored pay card re-mounts.
 */
export function payCard(deps: AgentDeps, doc: ToolDoc, view: DraftView<"run">, live: DraftLive = {}): StructuredContent<"pay"> {
  const network = networkByCaip2(doc.price.network);
  if (!network) throw new AgentToolError("unsupported", `${doc.id} is priced on ${doc.price.network}, which Hako can't pay on.`);
  const { usdc } = network;
  const { priceAtomic } = view.input;
  return card(
    "pay",
    {
      draftId: view.id,
      version: view.version,
      state: view.state,
      tool: { id: doc.id, displayName: doc.displayName, provider: doc.provider, providerName: doc.providerName, render: doc.render, summary: doc.summary },
      price: {
        token: { chain: network.caip2, address: usdc.address, symbol: usdc.symbol, decimals: usdc.decimals, name: usdc.name },
        amountAtomic: priceAtomic,
        // The catalog's USD price, only while it still matches the price frozen on this version.
        usd: doc.price.atomic === priceAtomic ? doc.price.usd : null,
      },
      paidUrl: deps.gateway.url("run", { params: { provider: doc.provider, slug: doc.slug } }),
      method: "POST",
      input: view.input.input as Record<string, unknown>,
    },
    {
      phase: live.phase ?? intentStateToPhase(view.state),
      intent: { id: view.id, version: view.version, state: view.state },
      ...(live.request ? { request: live.request } : {}),
    },
    deps,
  );
}
