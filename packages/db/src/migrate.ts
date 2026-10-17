/**
 * The migration runner: plain SQL files in `packages/db/migrations`, applied in file-name order, each in its own
 * transaction, each recorded with its checksum in `hako_migrations`. Re-running applies nothing new (idempotent);
 * an applied file whose content changed stops the run (a migration is never edited after it ran — add a new one).
 * The whole run holds a Postgres advisory lock, so two deploys starting at once apply every file exactly once.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type pg from "pg";

import { MIGRATION_LOCK_KEY, MIGRATIONS_TABLE } from "./db.config.ts";

/** The committed migrations folder (`packages/db/migrations`). */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

const SQL_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

export class MigrationChecksumError extends Error {
  readonly migration: string;
  constructor(migration: string) {
    super(`Migration ${migration} changed after it was applied. Revert the edit and add a new migration instead.`);
    this.name = "MigrationChecksumError";
    this.migration = migration;
  }
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Every `NNNN_name.sql` file in `dir`, sorted by name. */
export async function readMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((name) => SQL_FILE.test(name)).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(`${dir}/${name}`, "utf8");
      return { name, sql, checksum: sha256(sql) };
    }),
  );
}

/** Applies every migration not yet recorded. Returns what ran and what was already there. */
export async function runMigrations(
  pool: pg.Pool,
  options: { dir?: string; log?: (line: string) => void } = {},
): Promise<MigrationReport> {
  const log = options.log ?? (() => undefined);
  const files = await readMigrations(options.dir);
  const client = await pool.connect();
  const report: MigrationReport = { applied: [], skipped: [] };
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(
      `create table if not exists ${MIGRATIONS_TABLE} (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`,
    );
    const done = await client.query<{ name: string; checksum: string }>(`select name, checksum from ${MIGRATIONS_TABLE}`);
    const applied = new Map(done.rows.map((row) => [row.name, row.checksum]));
    for (const file of files) {
      const previous = applied.get(file.name);
      if (previous !== undefined) {
        if (previous !== file.checksum) throw new MigrationChecksumError(file.name);
        report.skipped.push(file.name);
        continue;
      }
      await applyOne(client, file);
      report.applied.push(file.name);
      log(`applied ${file.name}`);
    }
    return report;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

async function applyOne(client: pg.PoolClient, file: MigrationFile): Promise<void> {
  await client.query("begin");
  try {
    await client.query(file.sql);
    await client.query(`insert into ${MIGRATIONS_TABLE} (name, checksum) values ($1, $2)`, [file.name, file.checksum]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${file.name} failed and was rolled back: ${reason}`, { cause: error });
  }
}
