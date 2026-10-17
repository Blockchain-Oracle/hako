/**
 * Every HTTP route of the gateway except /mcp (src/mcp):
 *   free   GET  /v1/catalog · POST /v1/discover · POST /v1/inspect · GET /v1/endpoints/:p/:s
 *          POST /v1/validate/:p/:s · /.well-known/x402
 *   paid   POST /v2/run/:provider/:slug  — x402 exact in USDC on Base mainnet (CDP facilitator), payable from PayBox,
 *          settled only on success. Mounted only when the CDP key is set.
 * L1 adds the money routes beside these (routes/{money,rehearse,broadcast,batch,invoice,receipts,logo,files,aliases}).
 */

import type { Context, Hono } from "hono";

import { gatewayConfig } from "../config.js";
import {
  ENDPOINT_HEADER,
  HTTP_BAD_GATEWAY,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNAVAILABLE,
  HTTP_UNPROCESSABLE,
  RUN_PREFIX,
  RUN_V2_PREFIX,
  SERVICE_ID,
  SPEC_PATH,
  VALIDATE_PREFIX,
} from "../constants.js";
import { jsonError } from "../errors.js";
import { forwardRead, forwardRun } from "../forward.js";
import type { Forwarded } from "../forward.js";
import { startCatalogRefresh, state } from "./catalog-state.js";
import { registerX402Routes } from "./x402/index.js";

const catalogLoading = (c: Context) =>
  jsonError(c, HTTP_UNAVAILABLE, "catalog_unavailable", "The tool catalog has not loaded yet; nothing was charged.");

function passThrough(forwarded: Forwarded) {
  return new Response(forwarded.body, { status: forwarded.status, headers: { "content-type": forwarded.contentType } });
}

/** The catalog keys every tool by its /v1 path; /v2 serves the same tool, so lookups and runs use the /v1 path. */
const catalogPath = (c: Context) => `${RUN_PREFIX}/${c.req.param("provider")}/${c.req.param("slug")}`;
const paidPath = (path: string) => path.replace(RUN_PREFIX, RUN_V2_PREFIX);

export function registerRoutes(app: Hono): void {
  const config = gatewayConfig();
  startCatalogRefresh(config);

  const identity = () => ({
    service: SERVICE_ID,
    gateway: "hako-gateway",
    catalog: state.catalog?.hash ?? null,
    endpoints: state.endpointsByPath.size,
    network: config.mainnet?.network ?? null,
    payTo: config.mainnet?.payTo ?? null,
  });

  app.get("/", (c) => c.json(identity()));
  app.get("/v1/version", (c) => c.json(identity()));
  app.get("/v1/health", (c) => c.json({ status: "ok" }));
  app.get("/v1/catalog", (c) => (state.catalog ? c.json(state.catalog) : catalogLoading(c)));
  // The OpenAPI document of the tool router (every spec URL resolves over https).
  app.get(SPEC_PATH, async () => passThrough(await forwardRead(config, "GET", SPEC_PATH)));

  app.get("/.well-known/x402", (c) =>
    c.json({
      version: 1,
      resources: config.mainnet ? [...state.endpointsByPath.keys()].map((path) => `${config.publicBaseUrl}${paidPath(path)}`) : [],
    }),
  );

  app.post("/v1/discover", async (c) => passThrough(await forwardRead(config, "POST", "/v1/discover", await c.req.text())));
  app.post("/v1/inspect", async (c) => passThrough(await forwardRead(config, "POST", "/v1/inspect", await c.req.text())));
  // Hono decodes %2F inside a param: re-encode each one so a param can never add path segments upstream.
  app.get("/v1/endpoints/:provider/:slug", async (c) => {
    const [provider, slug] = [c.req.param("provider"), c.req.param("slug")].map(encodeURIComponent);
    return passThrough(await forwardRead(config, "GET", `/v1/endpoints/${provider}/${slug}`));
  });
  // Only a catalog id is forwarded, never the raw params: a crafted id cannot reach another api route (such as a run).
  app.post(`${VALIDATE_PREFIX}/:provider/:slug`, async (c) => {
    if (!state.catalog) return catalogLoading(c);
    const path = catalogPath(c);
    if (!state.endpointsByPath.has(path)) {
      return jsonError(c, HTTP_NOT_FOUND, "unknown_endpoint", `no endpoint at ${c.req.path}`,
        ["POST /v1/discover with {query} to find one"]);
    }
    return passThrough(await forwardRead(config, "POST", path.replace(RUN_PREFIX, VALIDATE_PREFIX), await c.req.text()));
  });
  // /v1/run/<id> names a tool in the catalog; it runs nothing. Point callers at the paid route.
  app.post(`${RUN_PREFIX}/:provider/:slug`, (c) =>
    jsonError(c, HTTP_NOT_FOUND, "not_found", `no route ${c.req.method} ${c.req.path}`,
      [`POST ${paidPath(catalogPath(c))} runs this tool, paid in USDC with x402 (PayBox core use_service)`]),
  );

  /**
   * Before any 402: an input that cannot run is rejected for free (nobody signs for a 422).
   * An empty body goes straight to the 402: x402 buyers such as PayBox's use_service probe the price without the body
   * and send it only on the paid retry, which the api validates again (a 422 then is not settled).
   */
  async function prevalidate(c: Context, next: () => Promise<void>) {
    if (c.req.header("payment-signature") || c.req.header("x-payment")) return next();
    const path = catalogPath(c);
    if (!state.endpointsByPath.has(path)) return next();
    const body = await c.req.raw.clone().text();
    if (!body.trim()) return next();
    // Only a verdict on the input blocks (400 bad JSON, 422 bad fields); anything else (a hiccup, a timeout, an
    // unreachable api) falls through to the normal paid path, where the api validates again anyway.
    let checked: Forwarded;
    try {
      checked = await forwardRead(config, "POST", path.replace(RUN_PREFIX, VALIDATE_PREFIX), body);
    } catch {
      return next();
    }
    return checked.status === HTTP_BAD_REQUEST || checked.status === HTTP_UNPROCESSABLE ? passThrough(checked) : next();
  }

  app.post(`${RUN_V2_PREFIX}/:provider/:slug`, prevalidate);

  // Payment runs before the handler: unpaid → 402 with the price; paid → handler → settle only if status < 400.
  app.use(`${RUN_V2_PREFIX}/*`, async (c, next) => {
    if (!config.mainnet) {
      return jsonError(c, HTTP_NOT_FOUND, "mainnet_disabled", "Paid runs are not enabled on this gateway.");
    }
    return state.payments ? state.payments(c, next) : catalogLoading(c);
  });

  app.post(`${RUN_V2_PREFIX}/:provider/:slug`, async (c) => {
    const path = catalogPath(c);
    if (!state.endpointsByPath.has(path)) {
      return jsonError(c, HTTP_NOT_FOUND, "unknown_endpoint", `no endpoint at ${c.req.path}`,
        ["POST /v1/discover with {query} to find one"]);
    }
    const body = await c.req.text();
    try {
      JSON.parse(body || "{}");
    } catch {
      return jsonError(c, HTTP_BAD_REQUEST, "invalid_json", "Request body is not valid JSON.");
    }
    let forwarded: Forwarded;
    try {
      forwarded = await forwardRun(config, path, body || "{}");
    } catch (error) {
      console.error(JSON.stringify({ event: "run_forward_failed", path, error: String(error) }));
      return jsonError(c, HTTP_BAD_GATEWAY, "api_unreachable", "The tool router could not be reached; you were not charged.");
    }
    const response = passThrough(forwarded);
    response.headers.set(ENDPOINT_HEADER, path.slice(RUN_PREFIX.length + 1));
    if (forwarded.status === HTTP_OK) {
      const envelope = JSON.parse(forwarded.body) as { billable?: boolean };
      // A "does not exist" answer is data, not a sale: answer 404 so the payment middleware never settles it.
      if (envelope.billable === false) {
        return new Response(forwarded.body, { status: HTTP_NOT_FOUND, headers: response.headers });
      }
    }
    return response;
  });

  registerX402Routes(app);
}
