import { HAKO_GATEWAY_URL, HAKO_LOGO_PROXY_PARAM, HAKO_LOGO_PROXY_PATH } from "@hako/config";

/**
 * A remote logo (LI.FI's `logoURI` for a token or a route) through the gateway's allowlisted proxy (plan B12): one
 * cached host for the 10+ logo hosts LI.FI points at, and the only image host the MCP view's CSP allows.
 */
export const logoProxyUrl = (src: string, gatewayUrl: string = HAKO_GATEWAY_URL): string =>
  `${gatewayUrl}${HAKO_LOGO_PROXY_PATH}?${new URLSearchParams({ [HAKO_LOGO_PROXY_PARAM]: src })}`;
