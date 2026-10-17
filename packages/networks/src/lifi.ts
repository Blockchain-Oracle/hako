import type { EvmNetworkKey } from "./types.js";

/**
 * LI.FI's contract allowlist for R15: a LI.FI proposal is bound only when `transactionRequest.to` is one of these on
 * the source chain (compare case-insensitively). Fail closed: anything else is refused.
 *
 * Source: https://li.quest/v1/chains?chainTypes=EVM,SVM, field `diamondAddress`, fetched 2026-10-17 — the LiFiDiamond
 * is the same address on Base, Ethereum, Arbitrum, OP Mainnet and Polygon, and is also the `approvalAddress` LI.FI
 * quotes name for ERC-20 approvals. LI.FI's Permit2Proxy (`permit2Proxy`, 0x89c6340B1a1f4b25D36cd8B063D49045caF3f818
 * on the same chains) is deliberately absent: Hako's flow is an exact approve followed by the transfer (R16), never a
 * Permit2 signature, so a quote targeting it is not one Hako asked for.
 *
 * Solana has no contract allowlist: R15 binds a Solana LI.FI transaction by size (≤ 1,232 bytes) and by its single
 * required signer being the sender.
 */
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";

export const LIFI_CONTRACT_ALLOWLIST: Readonly<Record<EvmNetworkKey, readonly string[]>> = {
  base: [LIFI_DIAMOND],
  ethereum: [LIFI_DIAMOND],
  arbitrum: [LIFI_DIAMOND],
  optimism: [LIFI_DIAMOND],
  polygon: [LIFI_DIAMOND],
};

/** True when `target` is on LI.FI's allowlist for that EVM network. */
export function isLifiContract(network: EvmNetworkKey, target: string): boolean {
  const wanted = target.toLowerCase();
  return LIFI_CONTRACT_ALLOWLIST[network].some((address) => address.toLowerCase() === wanted);
}
