/**
 * @hako/db's own numbers (plan §5b: feature-local numbers live in a `*.config.ts`). Shared limits (invoice note
 * length, polling, TTLs) stay in @hako/config and are enforced by the callers that validate input.
 */

/** Connections per process: the web server, the gateway and the CLI each hold one small pool. */
export const DB_POOL_MAX = 10;
/** An idle connection is closed after this long (ms). */
export const DB_IDLE_TIMEOUT_MS = 30_000;
/** Connecting gives up after this long (ms), so a down database fails a request instead of hanging it. */
export const DB_CONNECT_TIMEOUT_MS = 5_000;

/** Lists (activity, receipts, invoices, contacts) return this many rows unless asked, and never more than the max. */
export const DB_LIST_DEFAULT_LIMIT = 50;
export const DB_LIST_MAX_LIMIT = 200;

/** Invoice ids are short (they are the path of `usehako.site/pay/<id>` and its QR): this many base62 characters. */
export const INVOICE_ID_LENGTH = 12;
/** Values one random byte takes (ids are drawn from random bytes by rejection sampling). */
export const BYTE_VALUES = 256;

/**
 * One migration runner at a time: the runner holds this Postgres advisory lock for the whole run, so two deploys
 * starting together apply each file once. Any constant 64-bit key works; this one spells "hako" in ASCII.
 */
export const MIGRATION_LOCK_KEY = 0x68616b6f;
/** The table that records which migration files ran, with their checksums. */
export const MIGRATIONS_TABLE = "hako_migrations";
