/** Gateway constants. Every limit names the reason it has that value. */

export const SERVICE_NAME = "Hako";
export const SERVICE_ID = "tool-router"; // the api's service name (catalog, identity and the spec path below)
// The catalog keys every tool by its /v1/run path. That path is an identifier here, never a route that runs a tool.
export const RUN_PREFIX = "/v1/run";
export const VALIDATE_PREFIX = "/v1/validate";
// The OpenAPI document of the tool router, served by the api and published here over https
export const SPEC_PATH = "/specs/tool-router.openapi.json";

// /v2: every paid run, in USDC on Base mainnet through Coinbase's CDP facilitator (key + JWT), payable from PayBox.
export const RUN_V2_PREFIX = "/v2/run";
export const MAINNET_NETWORK = "eip155:8453" as const; // Base mainnet, PayBox's EVM x402 rail
export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
export const CDP_JWT_TTL_S = 120; // a fresh JWT per facilitator call; two minutes covers verify → settle
export const PAYMENT_TIMEOUT_S = 60; // the signed authorization stays valid this long
// The method of every paid /v2 run, named by /mcp's hako_inspect in howToPay
export const PAID_METHOD = "POST";
// The facilitator's relayer races itself when two settlements overlap (serial-facilitator.ts): queue them, and retry
// a lost race once after roughly one Base block (2 s), well inside PAYMENT_TIMEOUT_S.
export const SETTLE_RETRY_ATTEMPTS = 2;
export const SETTLE_RETRY_DELAY_MS = 1_500;
export const SETTLE_RACE_MARKERS = ["replacement transaction underpriced", "nonce too low", "already known"];

// A run must answer inside a PayBox plugin operation's 10 s; the API's own per-endpoint deadline is ≤ 9 s.
export const RUN_FORWARD_TIMEOUT_MS = 9_500;
export const READ_FORWARD_TIMEOUT_MS = 4_000;
export const CATALOG_FETCH_TIMEOUT_MS = 5_000;
export const CATALOG_RETRY_DELAY_MS = 2_000;
export const CATALOG_RETRY_ATTEMPTS = 30; // ~1 minute: the api container may still be starting
export const ANY_ORIGIN = "*";
export const MAX_BODY_BYTES = 65_536; // tool inputs are small JSON bodies; the api enforces the same 64 KiB cap
// The api may deploy without the gateway: re-read its catalog this often and rebuild the paid route table on change.
export const CATALOG_REFRESH_MS = 60_000;

// Status codes the gateway produces itself
export const HTTP_OK = 200;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_NOT_FOUND = 404;
export const HTTP_UNPROCESSABLE = 422;
export const HTTP_PAYLOAD_TOO_LARGE = 413;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_UNAVAILABLE = 503;

// Headers browsers must be allowed to read for the x402 flow
export const EXPOSED_HEADERS = ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-Hako-Endpoint"];
export const ENDPOINT_HEADER = "X-Hako-Endpoint";

// Remote MCP (/mcp): free tools only
export const MCP_MAX_TEXT_CHARS = 12_000;
export const DEFAULT_DISCOVER_LIMIT = 5;
export const MAX_DISCOVER_LIMIT = 25;
