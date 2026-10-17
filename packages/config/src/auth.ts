import { PAYBOX_MCP_URL } from "./hosts.ts";
import { SECONDS_PER_MINUTE } from "./units.ts";

/** Connect PayBox (plan §1 execution rules): PKCE S256, these scopes, this resource, one public client per Hako user. */
export const PAYBOX_OAUTH_SCOPE = "mcp offline_access";
export const PAYBOX_OAUTH_RESOURCE = PAYBOX_MCP_URL;
export const PKCE_METHOD = "S256";
/** A PayBox access token lives an hour; the refresh token rotates on every use (SP13). */
export const PAYBOX_ACCESS_TOKEN_TTL_S = 60 * SECONDS_PER_MINUTE;
/** Refresh proactively when less than this is left (CLI file lock, server per-user Redis lock). */
export const TOKEN_REFRESH_SKEW_S = 60;

/** Hako's own OAuth scopes for MCP hosts (Better Auth, plan E32/E33). */
export const HAKO_OAUTH_SCOPE = "hako";
export const HAKO_OAUTH_SCOPES = [HAKO_OAUTH_SCOPE, "offline_access"] as const;

/** The CLI keeps PayBox's own config (tokens, the paired `pbxk1.` key) here, under the user's home directory. */
export const CLI_PAYBOX_CONFIG_DIR_SEGMENTS = [".config", "hako", "paybox"] as const;
/** The variable PayBox's CLI reads its config directory from. */
export const PAYBOX_CONFIG_DIR_ENV = "PAYBOX_CONFIG_DIR";
