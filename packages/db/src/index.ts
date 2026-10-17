// @hako/db (server-only, plan §5b): one Postgres schema — Better Auth's tables, receipts, invoices, contacts, drafts
// and PayBox links — with typed query helpers per table. Next code imports this root; the gateway and the CLI import
// `@hako/db/node` (the same exports without the `server-only` guard).
import "server-only";

import { loadWebEnv } from "@hako/env";

import { getPool, type Pool } from "./pool.ts";

export * from "./node.ts";

/** The web server's pool (DATABASE_URL), one per process. Throws, naming the variable, when it is not set. */
export function webPool(): Pool {
  const url = loadWebEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: @hako/db has no database to use.");
  return getPool(url, { applicationName: "hako-web" });
}
