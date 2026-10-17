import { networkByCaip2 } from "./lookup.ts";
import type { NetworkKey } from "./types.ts";

/**
 * R17: executable coverage is not routing coverage. LI.FI routes many chains; only a network on this list gets an
 * action button (a source chain the user signs on). Everything else is read-only with a reason.
 *
 * Base and Solana are the two source chains the validation runbook proves (plan §10: x402 and the EVM approve and
 * transfer on Base; step (8) the Solana LI.FI transaction). Ethereum, Arbitrum, OP Mainnet and Polygon stay quotable
 * destinations and readable chains until a portal "Validate transaction" and one real run prove them.
 */
export const EXECUTABLE_NETWORK_KEYS = ["base", "solana"] as const satisfies readonly NetworkKey[];
export type ExecutableNetworkKey = (typeof EXECUTABLE_NETWORK_KEYS)[number];

export function isExecutableNetwork(key: NetworkKey): key is ExecutableNetworkKey {
  return (EXECUTABLE_NETWORK_KEYS as readonly NetworkKey[]).includes(key);
}

/** True when a CAIP-2 id (or one of its aliases) names an executable network. */
export function isExecutableCaip2(caip2: string): boolean {
  const network = networkByCaip2(caip2);
  return network !== undefined && isExecutableNetwork(network.key);
}
