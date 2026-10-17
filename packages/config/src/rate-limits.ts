/** Rate limits Hako designs around (plan §2). */

/** PayBox plugin: one start a second and 1,000 a day, per user. */
export const PLUGIN_STARTS_PER_SECOND = 1;
export const PLUGIN_STARTS_PER_DAY = 1_000;
/** LI.FI with an API key. */
export const LIFI_REQUESTS_PER_MINUTE = 200;
/** Artificial Analysis free tier (cached for ARTIFICIAL_ANALYSIS_CACHE_TTL_S). */
export const ARTIFICIAL_ANALYSIS_REQUESTS_PER_DAY = 1_000;
