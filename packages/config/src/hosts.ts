/**
 * Every public host and URL Hako talks to or serves (plan §1, §2, §8). Production values: a deployment points a
 * surface elsewhere through its environment (@hako/env), never by editing these.
 */

/** Hako's own hosts (plan §8: DNS A records for apex, www, api, docs and sandbox). */
export const HAKO_DOMAIN = "usehako.xyz";
export const HAKO_WWW_HOST = `www.${HAKO_DOMAIN}`;
/** The gateway (Hono): `/v1/*`, the x402 `/v2/*` routes and the hosted MCP server at `/mcp`. */
export const HAKO_GATEWAY_HOST = `api.${HAKO_DOMAIN}`;
export const HAKO_DOCS_HOST = `docs.${HAKO_DOMAIN}`;
/**
 * The signing host's second origin (SP4): served by hako-web, whose `proxy.ts` rewrites this host to `app/sandbox/**`
 * so PayBox's window runs in a sandboxed origin that is not the app's own. Any host whose first label is the
 * subdomain counts (sandbox.localhost in development, a staging host's sandbox name).
 */
export const HAKO_SANDBOX_SUBDOMAIN = "sandbox";
export const HAKO_SANDBOX_HOST = `${HAKO_SANDBOX_SUBDOMAIN}.${HAKO_DOMAIN}`;

export const HAKO_APP_URL = `https://${HAKO_DOMAIN}`;
export const HAKO_GATEWAY_URL = `https://${HAKO_GATEWAY_HOST}`;
export const HAKO_DOCS_URL = `https://${HAKO_DOCS_HOST}`;
export const HAKO_SANDBOX_URL = `https://${HAKO_SANDBOX_HOST}`;
/** One MCP URL everywhere (Claude, ChatGPT, Cursor, VS Code custom connectors). */
export const HAKO_MCP_URL = `${HAKO_GATEWAY_URL}/mcp`;
/** Better Auth, mounted by the web at `app/api/auth/[...all]` (plan E33): issuer and the JWKS the gateway verifies with. */
export const HAKO_AUTH_ISSUER = `${HAKO_APP_URL}/api/auth`;
export const HAKO_AUTH_JWKS_URL = `${HAKO_AUTH_ISSUER}/jwks`;

/** Local development: hako-api, the gateway and the web app on their dev ports (each service's .env.example). */
export const GATEWAY_DEFAULT_PORT = 8080;
export const LOCAL_HAKO_API_URL = "http://localhost:8000";
export const LOCAL_GATEWAY_URL = `http://localhost:${GATEWAY_DEFAULT_PORT}`;

/** Web routes other surfaces link to (MCP cards, the CLI, receipts, the plugin's text). */
export const HAKO_APP_PATHS = {
  agent: "/agent",
  tools: "/tools",
  activity: "/activity",
  /** `/sign/<id>`: hosts PayBox's signing window for the user's own PayBox client. */
  sign: "/sign",
  /** `/pay/<id>`: an invoice's public pay page (its QR encodes this short link). */
  pay: "/pay",
  /** `/r/<id>`: a shared receipt. */
  receipt: "/r",
  /** `/cli/<code>`: relays PayBox's login and pairing links to the terminal user. */
  cli: "/cli",
  sandbox: "/sandbox",
  skill: "/SKILL.md",
} as const;

/** PayBox (MoonPay): the wallet every Hako payment and money move is signed with. */
export const PAYBOX_SITE_URL = "https://paybox.sh";
export const PAYBOX_DOCS_URL = "https://docs.paybox.sh";
export const PAYBOX_DEVELOPER_URL = "https://developer.paybox.sh";
export const PAYBOX_API_HOST = "api.paybox.sh";
export const PAYBOX_APP_HOST = "app.paybox.sh";
export const PAYBOX_API_URL = `https://${PAYBOX_API_HOST}`;
export const PAYBOX_APP_URL = `https://${PAYBOX_APP_HOST}`;
/** PayBox core MCP tools (`use_service`, `request_wallet_sign`, `get_request`…), called with the user's bearer. */
export const PAYBOX_MCP_URL = `${PAYBOX_API_URL}/mcp`;
export const PAYBOX_OAUTH_REGISTER_URL = `${PAYBOX_API_URL}/oauth/register`;
export const PAYBOX_OAUTH_AUTHORIZE_URL = `${PAYBOX_API_URL}/oauth/authorize`;
export const PAYBOX_OAUTH_TOKEN_URL = `${PAYBOX_API_URL}/oauth/token`;
/** The pairing page `paybox connect` prints; the CLI relays only links on this exact prefix (plan §1, CLI login). */
export const PAYBOX_AGENT_KEY_URL = `${PAYBOX_APP_URL}/agent-key`;
/** Connect PayBox (web, hosted MCP, `/sign/<id>`): the redirect registered for every per-user PayBox client. */
export const PAYBOX_OAUTH_CALLBACK_PATH = "/api/paybox/callback";
export const PAYBOX_OAUTH_REDIRECT_URL = `${HAKO_APP_URL}${PAYBOX_OAUTH_CALLBACK_PATH}`;

/** LI.FI: quotes, routes, status (li.quest) and Earn (earn.li.fi). Hako takes no integrator fee. */
export const LIFI_API_HOST = "li.quest";
export const LIFI_EARN_HOST = "earn.li.fi";
export const LIFI_API_URL = `https://${LIFI_API_HOST}/v1`;
export const LIFI_EARN_API_URL = `https://${LIFI_EARN_HOST}/v1`;
export const LIFI_INTEGRATOR = "hako";
/** The header LI.FI reads the API key from (brokered by PayBox as a host-scoped secret for the plugin). */
export const LIFI_API_KEY_HEADER = "x-lifi-api-key";

/**
 * The hosts the PayBox plugin declares under Network access (plan §3 plugin row): the gateway and LI.FI. A Solana RPC
 * joins only after SP8 is recorded.
 */
export const PLUGIN_NETWORK_HOSTS = [HAKO_GATEWAY_HOST, LIFI_API_HOST, LIFI_EARN_HOST] as const;
