/** Hako PayBox plugin constants. Every limit names the reason it has that value; shared ones come from ./shared.ts. */
import { HAKO_APP_URL, X402_NETWORK } from "./shared.js";

export const PLUGIN_NAME = "hako";
export const PLUGIN_TITLE = "Hako";
export const PLUGIN_VERSION = "2.0.0";
export const PROTOCOL_VERSION = "2026-07-28"; // starter 1.0.2's MCP protocol version

/** Server identity, frozen with the bundle (plan §1 A). */
export const PLUGIN_DESCRIPTION =
  "80+ paid tools (live data, research, media) and LI.FI bridge, swap and earn, paid and signed with your PayBox wallet";
export const PLUGIN_WEBSITE_URL = HAKO_APP_URL;
/** The Hako mark the web app serves (apps/web/src/app/icon.ts, from @hako/brand): linked, never copied. */
export const PLUGIN_ICON = { src: `${HAKO_APP_URL}/icon`, mimeType: "image/svg+xml" } as const;
export const SERVER_INSTRUCTIONS =
  "Start with hako_discover, then hako_inspect, then hako_run or hako_run_batch. Money tools return a PayBox proposal: " +
  "follow its request id with get_request and never re-run the tool to finish it. Pass the wallet address from " +
  "list_credentials as fromAddress/payTo and the same wallet as use_plugin.wallet_id.";

// The gateway is a non-sensitive environment variable so the owner can point it elsewhere without a new upload.
export const GATEWAY_URL_ENV = "HAKO_GATEWAY_URL";
// Until usehako.xyz resolves the bundle ships the Hako gateway's sslip host; the portal variable HAKO_GATEWAY_URL switches it without an upload.
export const DEFAULT_GATEWAY_URL = "https://hako-api.84.46.247.92.sslip.io";

export const PAYMENT_REQUIRED_HEADER = "payment-required";

/** PayBox's x402 rails (starter paybox.ts `proposeX402`): Hako's paid routes settle on the first one. */
const PAYBOX_X402_CHAINS = ["eip155:8453", "solana:mainnet"] as const;
type PayboxX402Chain = (typeof PAYBOX_X402_CHAINS)[number];
function payboxRail(caip2: string): PayboxX402Chain {
  const rail = PAYBOX_X402_CHAINS.find((chain) => chain === caip2);
  if (!rail) throw new Error(`${caip2} is not a PayBox x402 rail.`);
  return rail;
}
/** Hako's `/v2` rail (@hako/networks X402_NETWORK): USDC on Base. */
export const X402_RAIL = {
  chain: payboxRail(X402_NETWORK.caip2),
  asset: X402_NETWORK.usdc.address,
  symbol: X402_NETWORK.usdc.symbol,
  decimals: X402_NETWORK.usdc.decimals,
} as const;

/** A proposal lives four minutes (the starter's default), under PayBox's five-minute ceiling (PROPOSAL_EXPIRY_LIMIT_S). */
export const PROPOSAL_TTL_S = 240;
/** A quote that expires sooner than this can't be reviewed and signed in time, so it isn't proposed. */
export const QUOTE_MIN_REMAINING_S = 20;
