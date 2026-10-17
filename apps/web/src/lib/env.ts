import { z } from "zod";

/**
 * Public (browser-visible) settings, validated once at import. NEXT_PUBLIC_* values are inlined at build time, and
 * only when referenced by their full literal name, so each is read explicitly below. An empty string (an unset CI
 * variable passed as a build arg) counts as unset.
 */
const LOCAL_APP_URL = "http://localhost:3100";
const LOCAL_DOCS_URL = "http://localhost:3200";
const LOCAL_API_URL = "http://localhost:8080"; // services/gateway in dev

const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default(LOCAL_APP_URL),
  NEXT_PUBLIC_DOCS_URL: z.url().default(LOCAL_DOCS_URL),
  NEXT_PUBLIC_API_URL: z.url().default(LOCAL_API_URL),
});

const orUnset = (value: string | undefined) => value || undefined;

export const publicEnv = schema.parse({
  NEXT_PUBLIC_APP_URL: orUnset(process.env.NEXT_PUBLIC_APP_URL),
  NEXT_PUBLIC_DOCS_URL: orUnset(process.env.NEXT_PUBLIC_DOCS_URL),
  NEXT_PUBLIC_API_URL: orUnset(process.env.NEXT_PUBLIC_API_URL),
});
