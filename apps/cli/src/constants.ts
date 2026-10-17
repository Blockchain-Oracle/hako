/** CLI / local MCP constants. Every number names its reason. */
export const VERSION = "0.1.1";
export const DEFAULT_API_URL = "https://api.usehako.xyz";
/** Paid runs: the gateway's mainnet x402 routes, which the user's PayBox wallet pays (PayBox core use_service). */
export const RUN_V2_PREFIX = "/v2/run";
export const PAID_NETWORK = "eip155:8453"; // Base mainnet, PayBox's EVM x402 rail
export const PAID_METHOD = "POST";
export const REQUEST_TIMEOUT_MS = 20_000;
export const DEFAULT_DISCOVER_LIMIT = 5;
export const MCP_MAX_TEXT_CHARS = 12_000; // what one MCP tool result returns to the model
