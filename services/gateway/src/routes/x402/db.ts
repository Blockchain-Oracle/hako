/** The gateway's one @hako/db pool (DATABASE_URL): invoices, receipts, and the /v2 run route's receipt hook. */

import { getPool, type Pool } from "@hako/db/node";
import { loadGatewayEnv } from "@hako/env/node";

let pool: Pool | null | undefined;

/** Null when DATABASE_URL is unset: invoices and receipt reads answer 503, settlements are only logged. */
export function gatewayPool(): Pool | null {
  if (pool === undefined) {
    const url = loadGatewayEnv().DATABASE_URL;
    pool = url ? getPool(url, { applicationName: "hako-gateway" }) : null;
  }
  return pool;
}
