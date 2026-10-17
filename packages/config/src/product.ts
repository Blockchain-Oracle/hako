/** Hako's names on every surface (plan §1 A, F; §8). */
export const HAKO_NAME = "Hako";
/** The PayBox plugin's MCP server name and the hosted MCP server's name. */
export const HAKO_MCP_SERVER_NAME = "hako";
/** npm package of the CLI (bare `hako` is taken on npm) and the binary it installs. */
export const HAKO_NPM_PACKAGE = "usehako";
export const HAKO_CLI_BIN = "hako";
/** The MCP Apps view is served as a versioned resource: `${HAKO_CARD_RESOURCE_PREFIX}<hash>.html` (plan E29). */
export const HAKO_CARD_RESOURCE_PREFIX = "ui://hako/card-";

/** Voice (plan D26, §3 Voice): OpenAI Realtime over WebRTC; the server mints an ephemeral `ek_…` secret per session. */
export const VOICE_REALTIME_MODEL = "gpt-realtime-2.1";
export const OPENAI_REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
