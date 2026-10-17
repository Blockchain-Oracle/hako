import { NETWORK_KEYS, NETWORKS } from "./registry.js";
import type { Caip2, EvmNetwork, Network, NetworkKey } from "./types.js";

const ALL: readonly Network[] = NETWORK_KEYS.map((key) => NETWORKS[key]);

export function isNetworkKey(value: unknown): value is NetworkKey {
  return typeof value === "string" && (NETWORK_KEYS as readonly string[]).includes(value);
}

/** The network for a CAIP-2 id, accepting the aliases each network lists (e.g. Solana's genesis-hash form). */
export function networkByCaip2(caip2: string): Network | undefined {
  return ALL.find((network) => network.caip2 === caip2 || (network.caip2Aliases as readonly string[]).includes(caip2));
}

export function networkByLifiChainId(lifiChainId: number): Network | undefined {
  return ALL.find((network) => network.lifiChainId === lifiChainId);
}

export function evmNetworkByChainId(chainId: number): EvmNetwork | undefined {
  return ALL.find((network): network is EvmNetwork => network.family === "evm" && network.chainId === chainId);
}

/** A CAIP-2 id in the form Hako emits (`networkByCaip2(alias).caip2`), or undefined for a chain Hako doesn't know. */
export function canonicalCaip2(caip2: string): Caip2 | undefined {
  return networkByCaip2(caip2)?.caip2;
}
