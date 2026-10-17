// Prints the SQL Better Auth needs for Hako's configuration (`hakoAuthOptions`) against DATABASE_URL: everything on an
// empty database, only the difference on a migrated one. This is what `auth generate` prints for the Kysely adapter
// (better-auth/db/migration `getMigrations().compileMigrations()`), without the CLI package.
//   DATABASE_URL=… BETTER_AUTH_SECRET=… pnpm --filter @hako/auth migration:generate > ../db/migrations/NNNN_better_auth_<what>.sql
import { createPool } from "@hako/db/node";
import { envLoader, optionalText, requiredUrl } from "@hako/env/node";
import { getMigrations } from "better-auth/db/migration";
import { z } from "zod";

import { hakoAuthOptions } from "../src/node.ts";

const loadEnv = envLoader(z.object({ DATABASE_URL: requiredUrl, BETTER_AUTH_SECRET: optionalText }), "@hako/auth migration:generate");

const env = loadEnv();
if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set.");
const pool = createPool(env.DATABASE_URL, { max: 1, applicationName: "hako-auth-generate" });
try {
  const migrations = await getMigrations(hakoAuthOptions({ pool, secret: env.BETTER_AUTH_SECRET }));
  for (const problem of [...migrations.unsafeChanges, ...migrations.schemaProblems]) console.error(`warning: ${problem}`);
  // With nothing to do, Kysely compiles an empty batch to a lone ";".
  const sql = (await migrations.compileMigrations()).trim().replace(/^;$/, "");
  process.stdout.write(sql === "" ? "-- Better Auth's schema is up to date.\n" : `${sql}\n`);
} finally {
  await pool.end();
}
