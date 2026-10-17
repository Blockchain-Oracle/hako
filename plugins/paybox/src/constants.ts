/** Hako PayBox plugin constants. Every limit names the reason it has that value. */

export const PLUGIN_NAME = "hako";
export const PLUGIN_VERSION = "0.1.0";
export const PROTOCOL_VERSION = "2026-07-28"; // starter 1.0.2's MCP protocol version

// The gateway is a non-sensitive environment variable so the owner can point it elsewhere without a new upload.
export const GATEWAY_URL_ENV = "HAKO_GATEWAY_URL";
// Until usehako.xyz resolves the bundle ships the Hako gateway's sslip host; the portal variable HAKO_GATEWAY_URL switches it without an upload.
export const DEFAULT_GATEWAY_URL = "https://hako-api.84.46.247.92.sslip.io";
export const RUN_V2_PREFIX = "/v2/run"; // mainnet USDC routes (CDP facilitator) that PayBox can pay

// PayBox: each operation has a ten-second budget; the guide suggests ~4 s per request.
export const FETCH_TIMEOUT_MS = 4_000;

// PayBox's EVM x402 rail (the only rail until the Solana mapping is proven).
export const BASE_CHAIN = "eip155:8453" as const;
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_DECIMALS = 6;
export const USDC_ATOMIC_PER_UNIT = 1_000_000; // 10 ** USDC_DECIMALS, for display text only

export const DISCOVER_DEFAULT_LIMIT = 5;
export const DISCOVER_MAX_LIMIT = 10; // keeps the result readable in PayBox's own interface
export const TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/;
export const QUERY_MAX_CHARS = 200;

export const HTTP_PAYMENT_REQUIRED = 402;
export const PAYMENT_REQUIRED_HEADER = "payment-required";
