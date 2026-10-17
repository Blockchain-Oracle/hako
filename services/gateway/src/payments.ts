/** x402 seller: one exact-price route per catalog endpoint, settled only when the run returns < 400. */

import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient, FacilitatorConfig, RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";

import type { Pool } from "@hako/db/node";

import type { Catalog } from "./catalog.js";
import { cdpAuthHeaders } from "./cdp-auth.js";
import type { MainnetConfig } from "./config.js";
import { PAYMENT_TIMEOUT_S, RUN_PREFIX, RUN_V2_PREFIX, SERVICE_NAME } from "./constants.js";
import { gatewayPool } from "./routes/x402/db.js";
import { recordSettlement } from "./routes/x402/settlement.js";
import { SerialFacilitator } from "./serial-facilitator.js";

type Rail = { prefix: string; network: `${string}:${string}`; payTo: `0x${string}` };

/** Exact `POST <prefix>/<provider>/<slug>` keys only: no wildcard, so no path can run unpaid. */
export function runRoutes(catalog: Catalog, publicBaseUrl: string, rail: Rail): Record<string, RouteConfig> {
  const routes: Record<string, RouteConfig> = {};
  for (const endpoint of catalog.endpoints) {
    if (!endpoint.available) continue;
    const path = endpoint.path.replace(RUN_PREFIX, rail.prefix);
    routes[`POST ${path}`] = {
      accepts: {
        scheme: "exact",
        price: `$${endpoint.price.usd}`,
        network: rail.network,
        payTo: rail.payTo,
        maxTimeoutSeconds: PAYMENT_TIMEOUT_S,
      },
      resource: `${publicBaseUrl}${path}`,
      description: `${endpoint.displayName}: ${endpoint.summary}`,
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
      tags: [endpoint.provider, ...endpoint.categories],
    };
  }
  return routes;
}

// One settlement queue per facilitator for the life of the process: the payment layer is rebuilt when the catalog
// changes, and a fresh queue would settle in parallel with the old one.
const facilitators = new Map<string, SerialFacilitator>();

function facilitatorFor(url: string, createAuthHeaders?: FacilitatorConfig["createAuthHeaders"]): SerialFacilitator {
  let facilitator = facilitators.get(url);
  if (!facilitator) {
    facilitator = new SerialFacilitator(new HTTPFacilitatorClient({ url, createAuthHeaders }));
    facilitators.set(url, facilitator);
  }
  return facilitator;
}

/** The CDP facilitator's one settlement queue: every paid route (runs, batches, invoices) settles through it. */
export function mainnetFacilitator(mainnet: MainnetConfig): SerialFacilitator {
  return facilitatorFor(mainnet.facilitatorUrl, cdpAuthHeaders(mainnet));
}

/**
 * A resource server for `exact` payments on `network` that records a receipt in `pool` (`@hako/db`; only logged
 * without one) for every settlement. Paid routes add their own settle hooks on top (claims for batches and invoices).
 */
export function resourceServer(facilitator: FacilitatorClient, network: `${string}:${string}`, pool: Pool | null): x402ResourceServer {
  return new x402ResourceServer(facilitator).register(network, new ExactEvmScheme()).onAfterSettle(recordSettlement(pool));
}

/** The paid route: every catalog tool on Base mainnet USDC through the CDP facilitator, payable from PayBox. */
export function paymentLayer(catalog: Catalog, publicBaseUrl: string, mainnet: MainnetConfig) {
  const server = resourceServer(mainnetFacilitator(mainnet), mainnet.network, gatewayPool());
  const rail = { prefix: RUN_V2_PREFIX, network: mainnet.network, payTo: mainnet.payTo };
  return paymentMiddleware(runRoutes(catalog, publicBaseUrl, rail), server);
}
