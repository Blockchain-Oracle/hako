/**
 * hako-gateway: the public front door (api.usehako.site). This file only builds the app: shared middleware, the HTTP
 * routes (src/routes), the hosted MCP server (src/mcp), the error envelope and the listener.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { gatewayConfig } from "./config.js";
import { CORS_MAX_AGE_S, EXPOSED_HEADERS, HTTP_BAD_GATEWAY, HTTP_NOT_FOUND, HTTP_PAYLOAD_TOO_LARGE, MAX_BODY_BYTES } from "./constants.js";
import { jsonError } from "./errors.js";
import { registerMcp } from "./mcp/index.js";
import { registerRoutes } from "./routes/index.js";

const config = gatewayConfig();
const app = new Hono();

app.use("*", cors({ origin: config.corsOrigins, exposeHeaders: EXPOSED_HEADERS, maxAge: CORS_MAX_AGE_S }));

app.use("*", async (c, next) => {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return jsonError(c, HTTP_PAYLOAD_TOO_LARGE, "payload_too_large", "Request body exceeds 64 KiB.");
  }
  await next();
});

registerRoutes(app);
registerMcp(app);

app.notFound((c) => jsonError(c, HTTP_NOT_FOUND, "not_found", `no route ${c.req.method} ${c.req.path}`));
app.onError((error, c) => {
  console.error(JSON.stringify({ event: "gateway_error", error: String(error) }));
  return jsonError(c, HTTP_BAD_GATEWAY, "gateway_error", "Gateway error; you were not charged.");
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(JSON.stringify({ event: "gateway_ready", port: info.port, network: config.mainnet?.network ?? null }));
});
