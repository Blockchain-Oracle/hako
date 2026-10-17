import { SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from "./units.js";

/** LI.FI quotes are cached by request hash this long (plan §2, data fetching and caching). */
export const QUOTE_CACHE_TTL_S = 15;
/** `POST /v1/batch` stores the validated calls and their frozen summed price this long (plan B12). */
export const BATCH_TTL_S = 15 * SECONDS_PER_MINUTE;
/** Audio bytes stored by hako-api and forwarded at `GET /v1/files/<id>` live this long (plan B12). */
export const FILE_TTL_S = SECONDS_PER_DAY;
/** The allowlisted logo proxy `GET /v1/logo?src=` caches each image this long (plan B12). */
export const LOGO_CACHE_TTL_S = SECONDS_PER_DAY;
/** Artificial Analysis allows 1,000 requests a day: its benchmarks are cached this long (plan §2, rate limits). */
export const ARTIFICIAL_ANALYSIS_CACHE_TTL_S = SECONDS_PER_HOUR;
