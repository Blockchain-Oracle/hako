import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { Hako } from "./client.js";
import { DEFAULT_DISCOVER_LIMIT, MAX_DISCOVER_LIMIT, MCP_MAX_TEXT_CHARS, VERSION } from "./constants.js";

const text = (value: unknown) => {
  const json = JSON.stringify(value, null, 1);
  return { content: [{ type: "text" as const, text: json.length > MCP_MAX_TEXT_CHARS ? `${json.slice(0, MCP_MAX_TEXT_CHARS)}\n…[truncated]` : json }] };
};

const failure = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
});

/** The local MCP server: the two free tools over stdio. It holds no key; paid runs go through the user's PayBox. */
export async function serveMcp(hako: Hako): Promise<void> {
  const server = new McpServer({ name: "hako", version: VERSION });

  server.registerTool(
    "hako_discover",
    {
      title: "Discover Hako tools",
      description:
        "Free. Rank Hako's tool catalog for a job (web search, page reading, cited answers, papers, news, weather, " +
        "maps, crypto and FX, GitHub and packages, time, dictionaries…). Returns ids, prices, health and hints.",
      inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(MAX_DISCOVER_LIMIT).optional() },
    },
    async ({ query, limit }) => {
      try {
        return text(await hako.discover(query, limit ?? DEFAULT_DISCOVER_LIMIT));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "hako_inspect",
    {
      title: "Inspect a Hako tool",
      description:
        "Free. One tool's contract: description, input JSON Schema, output schema, price, a working example and its " +
        "paidUrl. A run is paid in USDC on Base with the user's PayBox wallet: PayBox's use_service on the paidUrl.",
      inputSchema: { id: z.string().describe("e.g. firecrawl/search") },
    },
    async ({ id }) => {
      try {
        return text(await hako.inspect(id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  await server.connect(new StdioServerTransport());
}
