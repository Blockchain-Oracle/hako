/** A CAIP-2 chain id: `eip155:8453`, `solana:mainnet`. */
export type Caip2 = `${string}:${string}`;

export type NetworkFamily = "evm" | "solana";

export type EvmNetworkKey = "base" | "ethereum" | "arbitrum" | "optimism" | "polygon";
export type NetworkKey = EvmNetworkKey | "solana";

/** A token Hako names by address: the chain's native coin or its USDC. */
export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  /** As LI.FI names it: the zero address for EVM native coins, the system program for SOL, else the contract or mint. */
  address: string;
}

export interface Explorer {
  name: string;
  url: string;
  /** Path segment before a transaction hash or signature. */
  txPath: string;
  /** Path segment before an address or account. */
  addressPath: string;
}

interface NetworkBase {
  key: NetworkKey;
  name: string;
  family: NetworkFamily;
  /** The CAIP-2 id PayBox, x402 proposals and Hako's APIs carry. */
  caip2: Caip2;
  /** Other spellings of the same chain that inputs may carry (looked up, never emitted). */
  caip2Aliases: readonly Caip2[];
  /** LI.FI's numeric chain id and short key (https://li.quest/v1/chains). */
  lifiChainId: number;
  lifiKey: string;
  explorer: Explorer;
  /** Public RPC endpoints, primary first. No Alchemy (plan §11); the gateway's Helius key is not one of these. */
  rpcUrls: readonly string[];
  native: TokenInfo;
  usdc: TokenInfo;
}

export interface EvmNetwork extends NetworkBase {
  key: EvmNetworkKey;
  family: "evm";
  chainId: number;
}

export interface SolanaNetwork extends NetworkBase {
  key: "solana";
  family: "solana";
}

export type Network = EvmNetwork | SolanaNetwork;
