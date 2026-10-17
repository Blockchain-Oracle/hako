/**
 * The hosted MCP server at /mcp (Streamable HTTP, stateless). Today: the free hako_discover and hako_inspect
 * (src/mcp/server.ts). L5 builds the MCP Apps tools, the auth gate and the card resource here (mcp/{server,tools,ui}).
 */

import type { Hono } from "hono";

import { gatewayConfig } from "../config.js";
import { mcpHandler } from "./server.js";

export function registerMcp(app: Hono): void {
  const mcp = mcpHandler(gatewayConfig());
  app.all("/mcp", (c) => mcp(c.req.raw));
}
