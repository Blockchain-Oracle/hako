/**
 * x402 `exact` routes whose price and payee depend on the id in the path (plan B12): `GET /v2/batch/<batchId>` (the
 * stored batch's frozen sum, to Hako) and `GET /v2/invoice/<id>` (the invoice's amount, straight to its payee). Same
 * facilitator queue and receipt hook as `/v2/run` (src/payments.ts); each resource adds a claim around settlement:
 * `onBeforeSettle` claims the id or aborts the settlement, `onAfterSettle` records the outcome, `onSettleFailure`
 * releases the claim so the id can be paid again.
 */

import { x402HTTPResourceServer } from "@x402/core/server";
import type { HTTPAdapter, HTTPProcessResult, HTTPRequestContext, HTTPTransportContext, PaywallConfig, RouteConfig, RoutesConfig } from "@x402/core/server";
import type { SettleResponse } from "@x402/core/types";
import { paymentMiddlewareFromHTTPServer } from "@x402/hono";
import type { MiddlewareHandler } from "hono";

import { HTTP_NOT_FOUND, PAYMENT_TIMEOUT_S, SERVICE_NAME } from "../../constants.js";
import { jsonError } from "../../errors.js";
import { resourceServer } from "../../payments.js";
import type { X402Context } from "./context.js";
import { matchPath } from "./http.js";
import { settledPath } from "./settlement.js";

export type PathParams = Record<string, string>;

export interface PaidResource {
  /** The endpoint table's path (`/v2/batch/:batchId`); the same `:name` syntax Hono and x402 route on. */
  path: string;
  description: string;
  /** The exact price as x402 money (`$0.003`), fixed for the id. */
  price(params: PathParams): Promise<string>;
  payTo(params: PathParams): Promise<string>;
  /** The JSON body of the 402 (the batch's price, the open invoice). */
  unpaidBody(params: PathParams): Promise<unknown>;
  /** Claims the id for this settlement: null when claimed, else why the settlement must not happen. */
  claim(params: PathParams): Promise<string | null>;
  /** The settlement landed: `body` is what the handler answered (now delivered to the payer). */
  settled(params: PathParams, result: SettleResponse, body: Buffer | undefined): Promise<void>;
  /** The settlement failed after the claim: free the id again. */
  release(params: PathParams): Promise<void>;
}

/** Routes are matched on the path behind the proxy; the resource URL in the 402 names the public one. */
function publicAdapter(adapter: HTTPAdapter, publicBaseUrl: string): HTTPAdapter {
  return {
    getHeader: (name) => adapter.getHeader(name),
    getMethod: () => adapter.getMethod(),
    getPath: () => adapter.getPath(),
    getUrl: () => `${publicBaseUrl}${adapter.getPath()}`,
    getAcceptHeader: () => adapter.getAcceptHeader(),
    getUserAgent: () => adapter.getUserAgent(),
    getQueryParams: () => adapter.getQueryParams?.() ?? {},
    getQueryParam: (name) => adapter.getQueryParam?.(name),
    getBody: () => adapter.getBody?.(),
  };
}

class PublicUrlResourceServer extends x402HTTPResourceServer {
  constructor(
    server: ConstructorParameters<typeof x402HTTPResourceServer>[0],
    routes: RoutesConfig,
    private readonly publicBaseUrl: string,
  ) {
    super(server, routes);
  }

  override processHTTPRequest(context: HTTPRequestContext, paywallConfig?: PaywallConfig): Promise<HTTPProcessResult> {
    return super.processHTTPRequest({ ...context, adapter: publicAdapter(context.adapter, this.publicBaseUrl) }, paywallConfig);
  }
}

/** The payment middleware of one id-priced resource; 404 `mainnet_disabled` on a gateway without the paid rail. */
export function paidLayer(ctx: X402Context, resource: PaidResource): MiddlewareHandler {
  const rail = ctx.rail;
  if (!rail) {
    return async (c) => jsonError(c, HTTP_NOT_FOUND, "mainnet_disabled", "Paid routes are not enabled on this gateway.");
  }
  const paramsOf = (path: string | null): PathParams | null => (path ? matchPath(resource.path, path) : null);
  const ofRequest = (context: HTTPRequestContext): PathParams => paramsOf(context.path) ?? {};

  const server = resourceServer(rail.facilitator, rail.network, ctx.pool)
    .onBeforeSettle(async (context) => {
      const params = paramsOf(settledPath(context));
      if (!params) return { abort: true, reason: "unknown_resource" };
      try {
        const refused = await resource.claim(params);
        return refused ? { abort: true, reason: refused } : undefined;
      } catch (error) {
        // A claim that cannot be taken must stop the settlement: nobody pays for something two payers could claim.
        return { abort: true, reason: "claim_unavailable", message: String(error) };
      }
    })
    .onAfterSettle(async (context) => {
      const params = paramsOf(settledPath(context));
      if (!params) return;
      const transport = context.transportContext as Partial<HTTPTransportContext> | undefined;
      await resource.settled(params, context.result as SettleResponse, transport?.responseBody);
    })
    .onSettleFailure(async (context) => {
      const params = paramsOf(settledPath(context));
      if (params) await resource.release(params);
    });

  const route: RouteConfig = {
    accepts: {
      scheme: "exact",
      network: rail.network,
      price: (context) => resource.price(ofRequest(context)),
      payTo: (context) => resource.payTo(ofRequest(context)),
      maxTimeoutSeconds: PAYMENT_TIMEOUT_S,
    },
    description: resource.description,
    mimeType: "application/json",
    serviceName: SERVICE_NAME,
    unpaidResponseBody: async (context) => ({ contentType: "application/json", body: await resource.unpaidBody(ofRequest(context)) }),
  };
  // No verb in the key: Hono answers HEAD with the GET handlers, and a HEAD must not run a batch unpaid either.
  const http = new PublicUrlResourceServer(server, { [resource.path]: route }, ctx.publicBaseUrl);
  return paymentMiddlewareFromHTTPServer(http);
}
