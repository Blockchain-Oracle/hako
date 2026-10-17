/**
 * Limits of the wire contract, mirrored from packages/cards/src/contract/contract.config.ts (the plugin can't import
 * @hako/cards). Shared limits that live in @hako/config (batch size, invoice note) come through ../shared.ts instead.
 */

/** `POST /v1/discover` (the api's DISCOVER_DEFAULT_LIMIT / DISCOVER_MAX_LIMIT / query cap). */
export const DISCOVER_LIMIT_DEFAULT = 5;
export const DISCOVER_LIMIT_MAX = 25;
export const DISCOVER_QUERY_MAX_CHARS = 300;
/** A catalog id `<provider>/<slug>` (the api's _ENDPOINT_ID_MAX). */
export const TOOL_ID_MAX_CHARS = 120;

/** Markets and Earn reads: rows one answer asks for. */
export const MARKETS_LIMIT_DEFAULT = 5;
export const MARKETS_LIMIT_MAX = 20;
export const VAULTS_LIMIT_DEFAULT = 10;
export const VAULTS_LIMIT_MAX = 50;
export const MARKET_QUERY_MAX_CHARS = 200;

/** Chain reads: one contract call's arguments. */
export const CONTRACT_ARGS_MAX = 16;

/** The gateway's answers the plugin reads by status. */
export const HTTP_PAYMENT_REQUIRED = 402;
export const HTTP_NOT_FOUND = 404;
