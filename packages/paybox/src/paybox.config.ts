/**
 * @hako/paybox's own numbers and names (plan §5b: feature-local numbers live in a `*.config.ts`). Shared values —
 * PayBox URLs, scope, resource, TOKEN_REFRESH_SKEW_S, the polling schedule — come from @hako/config.
 */

/** OAuth calls to PayBox (register, token) give up after this long (ms). */
export const PAYBOX_OAUTH_TIMEOUT_MS = 10_000;
/** One PayBox MCP tool call gives up after this long (ms); a request is created, not awaited, so this is plenty. */
export const PAYBOX_TOOL_TIMEOUT_MS = 20_000;
/** An idle MCP session (and its inbound SSE stream) is closed after this long (ms). */
export const PAYBOX_SESSION_IDLE_MS = 30_000;

/** PKCE: 32 random bytes make a 43-character code verifier (RFC 7636); the state is 16 random bytes. */
export const PKCE_VERIFIER_BYTES = 32;
export const OAUTH_STATE_BYTES = 16;
/** A started Connect PayBox waits this long (s) for its callback: the consent screen plus PayBox's 5-minute code. */
export const CONNECT_PENDING_TTL_S = 600;

/** The per-user refresh lock: held at most this long (ms), waited for at most this long (ms), polled this often. */
export const REFRESH_LOCK_TTL_MS = 15_000;
export const REFRESH_LOCK_WAIT_MS = 20_000;
export const REFRESH_LOCK_POLL_MS = 200;

/** AES-256-GCM over stored tokens: 32-byte key, 12-byte IV, 16-byte tag; ciphertexts are tagged with this version. */
export const TOKEN_KEY_BYTES = 32;
export const TOKEN_IV_BYTES = 12;
export const TOKEN_TAG_BYTES = 16;
export const TOKEN_CIPHER_VERSION = "v1";

/** Redis keys: pending Connect PayBox authorizations (by state) and the per-user refresh lock. */
export const REDIS_CONNECT_PREFIX = "hako:paybox:connect:";
export const REDIS_REFRESH_LOCK_PREFIX = "hako:paybox:refresh-lock:";

/** How Hako names itself to PayBox: the per-user client's name and the MCP client's info. */
export const PAYBOX_CLIENT_NAME = "Hako";
export const PAYBOX_MCP_CLIENT_NAME = "hako";
export const PAYBOX_MCP_CLIENT_VERSION = "1.0.0";
/** `use_plugin` invocation ids are name-based UUIDs (8-4-4-4-12 hex) derived from `draft_id:version`. */
export const UUID_HEX_GROUPS = [8, 4, 4, 4, 12] as const;
export const UUID_NAME_BASED_VERSION = "5";
export const UUID_VARIANT_MASK = 0x3;
export const UUID_VARIANT_BITS = 0x8;
export const HEX_RADIX = 16;

/** The header an MCP host uses to declare its signing surface (SDK 2.2.0 README). */
export const PAYBOX_SIGNING_SURFACE_HEADER = "x-paybox-signing-surface";
