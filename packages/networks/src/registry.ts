import type { EvmNetwork, EvmNetworkKey, Explorer, Network, NetworkKey, SolanaNetwork, TokenInfo } from "./types.ts";

/**
 * The chain registry (plan §5b `@hako/networks`). Sources, fetched 2026-10-17:
 * - chain ids, keys, native coins, public RPCs and explorers: https://li.quest/v1/chains?chainTypes=EVM,SVM
 *   (`id`, `key`, `nativeToken`, `metamask.rpcUrls`, `metamask.blockExplorerUrls`);
 * - USDC addresses and decimals: https://li.quest/v1/token?chain=<id>&token=USDC (Circle's native USDC on each chain);
 * - `solana:mainnet`: the id PayBox's proposals, buy links and x402 rails use (context/02-plugin-development/
 *   transaction-proposals.md); the genesis-hash form is the CAIP-2 standard spelling, accepted as an alias.
 */

/** LI.FI names every EVM native coin by the zero address. */
export const EVM_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
/** LI.FI names SOL by the system program id. */
export const SOLANA_NATIVE_ADDRESS = "11111111111111111111111111111111";

const ETH: TokenInfo = { symbol: "ETH", name: "Ether", decimals: 18, address: EVM_NATIVE_ADDRESS };
const USDC_NAME = "USD Coin";
const USDC_DECIMALS = 6;
const usdc = (address: string): TokenInfo => ({ symbol: "USDC", name: USDC_NAME, decimals: USDC_DECIMALS, address });

/** Etherscan-family explorers share their paths. */
const etherscanLike = (name: string, url: string): Explorer => ({ name, url, txPath: "tx", addressPath: "address" });

export const BASE: EvmNetwork = {
  key: "base",
  name: "Base",
  family: "evm",
  caip2: "eip155:8453",
  caip2Aliases: [],
  chainId: 8453,
  lifiChainId: 8453,
  lifiKey: "bas",
  explorer: etherscanLike("Basescan", "https://basescan.org"),
  rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
  native: ETH,
  usdc: usdc("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
};

export const ETHEREUM: EvmNetwork = {
  key: "ethereum",
  name: "Ethereum",
  family: "evm",
  caip2: "eip155:1",
  caip2Aliases: [],
  chainId: 1,
  lifiChainId: 1,
  lifiKey: "eth",
  explorer: etherscanLike("Etherscan", "https://etherscan.io"),
  rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  native: ETH,
  usdc: usdc("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
};

export const ARBITRUM: EvmNetwork = {
  key: "arbitrum",
  name: "Arbitrum",
  family: "evm",
  caip2: "eip155:42161",
  caip2Aliases: [],
  chainId: 42161,
  lifiChainId: 42161,
  lifiKey: "arb",
  explorer: etherscanLike("Arbiscan", "https://arbiscan.io"),
  rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org"],
  native: ETH,
  usdc: usdc("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
};

export const OPTIMISM: EvmNetwork = {
  key: "optimism",
  name: "OP Mainnet",
  family: "evm",
  caip2: "eip155:10",
  caip2Aliases: [],
  chainId: 10,
  lifiChainId: 10,
  lifiKey: "opt",
  explorer: etherscanLike("Optimism Etherscan", "https://optimistic.etherscan.io"),
  rpcUrls: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com", "https://optimism.drpc.org"],
  native: ETH,
  usdc: usdc("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
};

export const POLYGON: EvmNetwork = {
  key: "polygon",
  name: "Polygon",
  family: "evm",
  caip2: "eip155:137",
  caip2Aliases: [],
  chainId: 137,
  lifiChainId: 137,
  lifiKey: "pol",
  explorer: etherscanLike("Polygonscan", "https://polygonscan.com"),
  rpcUrls: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"],
  native: { symbol: "POL", name: "Polygon Ecosystem Token", decimals: 18, address: EVM_NATIVE_ADDRESS },
  usdc: usdc("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
};

export const SOLANA: SolanaNetwork = {
  key: "solana",
  name: "Solana",
  family: "solana",
  caip2: "solana:mainnet",
  caip2Aliases: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  lifiChainId: 1151111081099710,
  lifiKey: "sol",
  explorer: { name: "Solscan", url: "https://solscan.io", txPath: "tx", addressPath: "account" },
  rpcUrls: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"],
  native: { symbol: "SOL", name: "Solana", decimals: 9, address: SOLANA_NATIVE_ADDRESS },
  usdc: usdc("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
};

export const EVM_NETWORKS: Readonly<Record<EvmNetworkKey, EvmNetwork>> = {
  base: BASE,
  ethereum: ETHEREUM,
  arbitrum: ARBITRUM,
  optimism: OPTIMISM,
  polygon: POLYGON,
};

/** Every network Hako reads, quotes and shows, in display order. */
export const NETWORKS: Readonly<Record<NetworkKey, Network>> = { ...EVM_NETWORKS, solana: SOLANA };
export const NETWORK_KEYS = ["base", "ethereum", "arbitrum", "optimism", "polygon", "solana"] as const satisfies readonly NetworkKey[];

/** x402 rails: Hako's paid `/v2` routes settle USDC on Base (PayBox's EVM rail); Solana waits on SP8. */
export const X402_NETWORK = BASE;
