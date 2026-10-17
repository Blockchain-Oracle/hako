import { HAKO_GATEWAY_URL } from "@hako/config";

import { LOGO_PROXY_PARAM, LOGO_PROXY_PATH } from "./identity.config.ts";

/**
 * A remote logo (LI.FI's `logoURI` for a token or a route) through the gateway's allowlisted proxy (plan B12): one
 * cached host for the 10+ logo hosts LI.FI points at, and the only image host the MCP view's CSP allows.
 */
export const logoProxyUrl = (src: string, gatewayUrl: string = HAKO_GATEWAY_URL): string =>
  `${gatewayUrl}${LOGO_PROXY_PATH}?${new URLSearchParams({ [LOGO_PROXY_PARAM]: src })}`;
