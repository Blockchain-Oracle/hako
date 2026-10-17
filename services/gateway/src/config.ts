/** Runtime configuration from the environment. Fails fast on anything the paid route cannot work without. */

import { ANY_ORIGIN, CDP_FACILITATOR_URL, MAINNET_NETWORK } from "./constants.js";

const DEFAULT_PORT = 8080;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

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

/**
 * X402_MAINNET_NETWORK is Base mainnet unless overridden. eip155:84532 (Base Sepolia) is a local-dev override only:
 * the production image (NODE_ENV=production) refuses any other network.
 */
function readNetwork(): `${string}:${string}` {
  const network = process.env.X402_MAINNET_NETWORK?.trim() || MAINNET_NETWORK;
  if (process.env.NODE_ENV === "production" && network !== MAINNET_NETWORK) {
    throw new Error(`X402_MAINNET_NETWORK must be ${MAINNET_NETWORK} in production (got ${network})`);
  }
  return network as `${string}:${string}`;
}

function readMainnet(): MainnetConfig | undefined {
  const cdpKeyId = process.env.CDP_API_KEY_ID?.trim();
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET?.trim().replace(/\\n/g, "\n");
  if (!cdpKeyId || !cdpKeySecret) return undefined;
  const payTo = required("HAKO_PAY_TO");
  if (!ADDRESS.test(payTo)) throw new Error("HAKO_PAY_TO must be a 0x address");
  return {
    network: readNetwork(),
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
  return {
    port: Number(process.env.PORT?.trim() || DEFAULT_PORT),
    apiUrl: required("HAKO_API_URL").replace(/\/$/, ""),
    publicBaseUrl: (process.env.HAKO_PUBLIC_URL?.trim() || `http://localhost:${DEFAULT_PORT}`).replace(/\/$/, ""),
    corsOrigins: corsOrigins(process.env.HAKO_CORS_ORIGINS ?? ANY_ORIGIN),
    mainnet: readMainnet(),
  };
}
