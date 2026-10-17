/** Auth headers for Coinbase's CDP x402 facilitator: one short-lived JWT per call, bound to its method and path. */

import { generateJwt } from "@coinbase/cdp-sdk/auth";

import { CDP_JWT_TTL_S } from "./constants.js";
import type { MainnetConfig } from "./config.js";

type Op = { method: "GET" | "POST"; path: string };
const OPS = {
  verify: { method: "POST", path: "/verify" },
  settle: { method: "POST", path: "/settle" },
  supported: { method: "GET", path: "/supported" },
} as const satisfies Record<string, Op>;

export function cdpAuthHeaders(mainnet: MainnetConfig) {
  const base = new URL(mainnet.facilitatorUrl);
  const bearer = async (op: Op) => {
    const jwt = await generateJwt({
      apiKeyId: mainnet.cdpKeyId,
      apiKeySecret: mainnet.cdpKeySecret,
      requestMethod: op.method,
      requestHost: base.host,
      requestPath: `${base.pathname}${op.path}`,
      expiresIn: CDP_JWT_TTL_S,
    });
    return { Authorization: `Bearer ${jwt}` };
  };
  return async () => ({
    verify: await bearer(OPS.verify),
    settle: await bearer(OPS.settle),
    supported: await bearer(OPS.supported),
  });
}
