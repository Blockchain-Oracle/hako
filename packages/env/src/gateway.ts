import { GATEWAY_DEFAULT_PORT } from "@hako/config";
import { z } from "zod";

import { heliusEnvShape, lifiEnvShape } from "./providers.js";
import { envLoader, nodeEnv, optionalHexKey32, optionalPem, optionalText, optionalUrl, portOr, requiredUrl } from "./shared.js";

/**
 * services/gateway (api.usehako.xyz). Only HAKO_API_URL is required; every other feature degrades without its
 * variables: no CDP key pair → no paid `/v2` route at all (never a half-configured one).
 */
export const gatewayEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  PORT: portOr(GATEWAY_DEFAULT_PORT),
  /** hako-api (the Python tool router): every read and every run is forwarded straight to it. */
  HAKO_API_URL: requiredUrl,
  /** This gateway's public URL, used in the x402 `resource` field; defaults to http://localhost:<PORT>. */
  HAKO_PUBLIC_URL: optionalUrl,
  /** Comma-separated browser origins allowed to call the gateway, or `*` (also when unset). */
  HAKO_CORS_ORIGINS: optionalText,
  /** Coinbase CDP facilitator for the paid `/v2` routes; both or neither. The secret may be a one-line PEM. */
  CDP_API_KEY_ID: optionalText,
  CDP_API_KEY_SECRET: optionalPem,
  /** The 0x address every `/v2` payment settles to (required, and checked, when the CDP keys are set). */
  HAKO_PAY_TO: optionalText,
  /** Unset = Base mainnet (eip155:8453). eip155:84532 is a local-dev override only; production refuses it. */
  X402_MAINNET_NETWORK: optionalText,
  /** Batches, invoices, quote and rehearsal caches, broadcast locks (plan B12/B13). */
  REDIS_URL: optionalText,
  /** @hako/db: receipts, invoices, drafts. */
  DATABASE_URL: optionalUrl,
  /** Decrypts the user's stored PayBox token when the gateway acts for a signed-in MCP user (@hako/paybox). */
  HAKO_TOKEN_ENCRYPTION_KEY: optionalHexKey32,
  /** Better Auth issuer whose JWKS the hosted MCP server verifies Hako JWTs against; defaults to production's. */
  HAKO_AUTH_ISSUER: optionalUrl,
  ...lifiEnvShape,
  ...heliusEnvShape,
});
export type GatewayEnv = z.output<typeof gatewayEnvSchema>;

export const loadGatewayEnv = envLoader(gatewayEnvSchema, "gateway");
