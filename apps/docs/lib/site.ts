import { z } from "zod";

import { LOCAL_DOCS_URL, PRODUCTION_API_URL, PRODUCTION_APP_URL } from "@/lib/constants/urls";

/** Public settings for the docs app (NEXT_PUBLIC_* are inlined at build; an empty string counts as unset). */
const env = z
  .object({
    NEXT_PUBLIC_DOCS_URL: z.url().default(LOCAL_DOCS_URL),
    NEXT_PUBLIC_APP_URL: z.url().default(PRODUCTION_APP_URL),
    NEXT_PUBLIC_API_URL: z.url().default(PRODUCTION_API_URL),
  })
  .parse({
    NEXT_PUBLIC_DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL || undefined,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || undefined,
  });

const trim = (url: string) => url.replace(/\/$/, "");

export const site = {
  docs: trim(env.NEXT_PUBLIC_DOCS_URL),
  /** The Hako site: SKILL.md, llms.txt and the agent chat live here. */
  app: trim(env.NEXT_PUBLIC_APP_URL),
  /** The public gateway agents call (free reads, and the /v2 runs a PayBox wallet pays over x402). */
  api: trim(env.NEXT_PUBLIC_API_URL),
  themeStorageKey: "hako-docs-theme-v2",
} as const;
