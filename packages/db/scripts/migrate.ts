// Applies the committed migrations to DATABASE_URL: `pnpm --filter @hako/db migrate`.
// Runs on Node's own TypeScript support (Node 24+); safe to repeat — applied files are skipped.
import { envLoader, requiredUrl } from "@hako/env/node";
import { z } from "zod";

import { runMigrations } from "../src/migrate.ts";
import { createPool } from "../src/pool.ts";

const loadMigrateEnv = envLoader(z.object({ DATABASE_URL: requiredUrl }), "@hako/db migrate");

const pool = createPool(loadMigrateEnv().DATABASE_URL, { max: 1, applicationName: "hako-migrate" });
try {
  const report = await runMigrations(pool, { log: (line) => console.log(line) });
  console.log(`migrations: ${report.applied.length} applied, ${report.skipped.length} already applied`);
} finally {
  await pool.end();
}
