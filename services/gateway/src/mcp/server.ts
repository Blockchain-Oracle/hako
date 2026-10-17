/**
 * Remote MCP at /mcp (Streamable HTTP, stateless): `claude mcp add --transport http hako <gateway>/mcp`.
 * Free tools only: hako_discover and hako_inspect. Hako holds no wallet and pays for nobody: a paid run is the
 * caller's own x402 payment to POST /v2/run/<id>, made with PayBox core `use_service`. hako_inspect names that URL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import type { GatewayConfig } from "../config.js";
import {
  DEFAULT_DISCOVER_LIMIT,
  HTTP_OK,
  MAX_DISCOVER_LIMIT,
  MCP_MAX_TEXT_CHARS,
  PAID_METHOD,
  RUN_V2_PREFIX,
} from "../constants.js";
import { forwardRead } from "../forward.js";

const text = (value: unknown) => {
  const json = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: "text" as const, text: json.length > MCP_MAX_TEXT_CHARS ? `${json.slice(0, MCP_MAX_TEXT_CHARS)}\n…[truncated]` : json }] };
};

type InspectDoc = Record<string, unknown> & { id: string; available: boolean };

/**
 * Where and how a tool runs for money: the same paidUrl and howToPay the CLI, local MCP and plugin add. /v2 exists
 * only with the CDP key, and only for available tools; otherwise paidUrl is null and howToPay says why.
 */
function paidRun(config: GatewayConfig, doc: InspectDoc): { paidUrl: string | null; howToPay: string } {
  if (!config.mainnet) return { paidUrl: null, howToPay: "Paid runs are not enabled on this gateway." };
  if (!doc.available) return { paidUrl: null, howToPay: "This tool is unavailable right now (provider key missing)." };
  const paidUrl = `${config.publicBaseUrl}${RUN_V2_PREFIX}/${doc.id}`;
  return {
    paidUrl,
    howToPay:
      `Paid per call in USDC on Base (${config.mainnet.network}) with your PayBox wallet: call PayBox's use_service ` +
      `with url ${paidUrl}, method ${PAID_METHOD} and the tool's input as body.`,
  };
}

export function mcpHandler(config: GatewayConfig) {
  return async (request: Request): Promise<Response> => {
    const server = new McpServer({ name: "hako", version: "0.1.0" });

    server.registerTool(
      "hako_discover",
      {
        title: "Discover Hako tools",
        description:
          "Free. Rank Hako's catalog for a job (web search, page reading, cited answers, papers, news, weather, " +
          "maps, crypto and FX, GitHub and packages, time, dictionaries…): ids, prices, health, hints.",
        inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(MAX_DISCOVER_LIMIT).optional() },
      },
      async ({ query, limit }) => {
        const out = await forwardRead(config, "POST", "/v1/discover", JSON.stringify({ query, limit: limit ?? DEFAULT_DISCOVER_LIMIT }));
        return text(out.body);
      },
    );

    server.registerTool(
      "hako_inspect",
      {
        title: "Inspect a Hako tool",
        description:
          "Free. One tool's contract: description, input JSON Schema, output schema, price and a working example, " +
          "plus paidUrl and howToPay: the URL that runs it, paid in USDC with PayBox core use_service.",
        inputSchema: { id: z.string().describe("e.g. wikipedia/summary") },
      },
      async ({ id }) => {
        const out = await forwardRead(config, "POST", "/v1/inspect", JSON.stringify({ id }));
        if (out.status !== HTTP_OK) return text(out.body);
        const doc = JSON.parse(out.body) as InspectDoc;
        return text({ ...doc, ...paidRun(config, doc) });
      },
    );

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
