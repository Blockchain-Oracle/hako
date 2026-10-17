/** Runtime configuration from @hako/env. Fails fast on anything the paid route cannot work without. */

import { GATEWAY_DEFAULT_PORT } from "@hako/config";
import { loadGatewayEnv } from "@hako/env/node";

import { ANY_ORIGIN, CDP_FACILITATOR_URL, MAINNET_NETWORK } from "./constants.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface GatewayConfig {
  port: number;
  /** hako-api: every read and every run is forwarded straight to it. */
  apiUrl: string;
  publicBaseUrl: string;
  corsOrigins: string | string[]; // "*" or an allowlist
  /** The paid /v2 route. Undefined (no CDP key) → no paid route at all, never a half-configured one. */
  mainnet: MainnetConfig | undefined;
}

export interface MainnetConfig {
  network: `${string}:${string}`;
  payTo: `0x${string}`;
  facilitatorUrl: string;
  cdpKeyId: string;
  cdpKeySecret: string;
}

type Env = ReturnType<typeof loadGatewayEnv>;

/**
 * X402_MAINNET_NETWORK is Base mainnet unless overridden. eip155:84532 (Base Sepolia) is a local-dev override only:
 * the production image (NODE_ENV=production) refuses any other network.
 */
function readNetwork(env: Env): `${string}:${string}` {
  const network = env.X402_MAINNET_NETWORK || MAINNET_NETWORK;
  if (env.NODE_ENV === "production" && network !== MAINNET_NETWORK) {
    throw new Error(`X402_MAINNET_NETWORK must be ${MAINNET_NETWORK} in production (got ${network})`);
  }
  return network as `${string}:${string}`;
}

function readMainnet(env: Env): MainnetConfig | undefined {
  const cdpKeyId = env.CDP_API_KEY_ID;
  const cdpKeySecret = env.CDP_API_KEY_SECRET;
  if (!cdpKeyId || !cdpKeySecret) return undefined;
  const payTo = env.HAKO_PAY_TO;
  if (!payTo) throw new Error("HAKO_PAY_TO is required");
  if (!ADDRESS.test(payTo)) throw new Error("HAKO_PAY_TO must be a 0x address");
  return {
    network: readNetwork(env),
    payTo: payTo as `0x${string}`,
    facilitatorUrl: CDP_FACILITATOR_URL,
    cdpKeyId,
    cdpKeySecret,
  };
}

/** Hono's cors() reads an array as an allowlist, so a bare "*" must stay a string to mean any origin. */
function corsOrigins(value: string): string | string[] {
  const origins = value.split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length === 0 || origins.includes(ANY_ORIGIN) ? ANY_ORIGIN : origins;
}

export function readConfig(): GatewayConfig {
  const env = loadGatewayEnv();
  return {
    port: env.PORT,
    apiUrl: env.HAKO_API_URL.replace(/\/$/, ""),
    publicBaseUrl: (env.HAKO_PUBLIC_URL || `http://localhost:${GATEWAY_DEFAULT_PORT}`).replace(/\/$/, ""),
    corsOrigins: corsOrigins(env.HAKO_CORS_ORIGINS ?? ANY_ORIGIN),
    mainnet: readMainnet(env),
  };
}

let current: GatewayConfig | undefined;

/** The process's configuration, read once on first use; routes and the MCP server share it. */
export function gatewayConfig(): GatewayConfig {
  current ??= readConfig();
  return current;
}
