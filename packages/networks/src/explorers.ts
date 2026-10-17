import type { Network } from "./types.ts";

/** A transaction on the network's explorer (EVM tx hash or Solana signature). */
export function explorerTxUrl(network: Network, hash: string): string {
  return `${network.explorer.url}/${network.explorer.txPath}/${encodeURIComponent(hash)}`;
}

/** An address (EVM) or account (Solana) on the network's explorer. */
export function explorerAddressUrl(network: Network, address: string): string {
  return `${network.explorer.url}/${network.explorer.addressPath}/${encodeURIComponent(address)}`;
}
