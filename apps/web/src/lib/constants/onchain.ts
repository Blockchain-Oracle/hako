/** Where Hako's paid runs settle: USDC on Base mainnet, over x402 (the gateway's /v2 routes). Public values only. */
export const PAYMENT_NETWORK = {
  /** CAIP-2 id of Base mainnet, PayBox's EVM x402 rail. */
  id: "eip155:8453",
  label: "Base",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  usdcDecimals: 6,
} as const;
