import pg from "pg";

import { DB_CONNECT_TIMEOUT_MS, DB_IDLE_TIMEOUT_MS, DB_POOL_MAX } from "./db.config.ts";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/** Anything a query helper can run on: the pool, or one client inside a transaction. */
export type Queryable = Pick<pg.Pool, "query">;

export interface PoolOptions {
  max?: number;
  /** Shown in `pg_stat_activity`, so a connection says which Hako process holds it. */
  applicationName?: string;
}

/** A new pool. Most callers want `getPool`, which keeps one per process and URL. */
export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? DB_POOL_MAX,
    idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    application_name: options.applicationName ?? "hako",
  });
  // An idle client losing its connection must not crash the process: the next query reconnects.
  pool.on("error", (error: Error) => console.warn(`[hako-db] idle client error: ${error.message}`));
  return pool;
}

type PoolSlot = { pools?: Map<string, pg.Pool> };
const slot = globalThis as typeof globalThis & { __hakoDbPools?: PoolSlot };

/**
 * One pool per process and connection string, kept on globalThis so Next's dev reloads and every package that
 * imports @hako/db (Better Auth, @hako/paybox, the route handlers) share it.
 */
export function getPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  const state = (slot.__hakoDbPools ??= {});
  const pools = (state.pools ??= new Map());
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = createPool(connectionString, options);
    pools.set(connectionString, pool);
  }
  return pool;
}

/** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
export async function withTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
