import { z } from "zod";

import { envLoader, optionalText } from "./shared.ts";

/** LI.FI: quotes, routes and status work keyless at lower limits; Earn answers 401 without a key (plan §10 open items). */
export const lifiEnvShape = { LIFI_API_KEY: optionalText };

/** Helius: Solana `simulateTransaction` for rehearsal (plan B13). Without it Solana moves show "Not rehearsed on Solana". */
export const heliusEnvShape = { HELIUS_API_KEY: optionalText };

/**
 * Keys of the paid catalog providers added for Hako (plan C16). hako-api (Python) reads them itself; this loader only
 * tells JS surfaces which of them are configured. A tool whose key is missing is listed as unavailable, never half-run.
 */
export const catalogProviderEnvSchema = z.object({
  ELEVENLABS_API_KEY: optionalText,
  EXA_API_KEY: optionalText,
  ARTIFICIAL_ANALYSIS_API_KEY: optionalText,
  ...heliusEnvShape,
  ...lifiEnvShape,
});
export type CatalogProviderEnv = z.output<typeof catalogProviderEnvSchema>;

export const loadCatalogProviderEnv = envLoader(catalogProviderEnvSchema, "catalog providers");
