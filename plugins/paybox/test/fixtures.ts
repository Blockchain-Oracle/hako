/**
 * Test inputs for the proposal builders (plan §12): a reviewed Base → Solana USDC route and the gateway answers the
 * plugin checks. Real addresses (Base USDC, LI.FI's Diamond, PayBox's Base wallet, the Solana USDC mint as a stand-in
 * Solana signer key); amounts are what a 1 USDC quote looks like. Nothing here is sent anywhere.
 */
import { decodeBase58 } from "../../../packages/defi/src/core/index.ts";
import { LIFI_DIAMOND, NETWORKS } from "../../../packages/networks/src/index.ts";
import type { ReviewedRoute } from "../src/shared.js";
import type { EarnMoveRequest, ProposalResponse, RouteData } from "../src/wire/money.js";

export const BASE_USDC = NETWORKS.base.usdc.address;
export const SOL_USDC = NETWORKS.solana.usdc.address;
export const EVM_WALLET = "0x92a3d3e85c701e00ea48998116c94bc0ee4bbf0a";
/** A valid 32-byte base58 key (the USDC mint), standing in for a Solana wallet. */
export const SOL_WALLET = SOL_USDC;
export const ONE_USDC = "1000000";
export const MIN_RECEIVED = "990000";
export const TOOL = "relaydepository";
/** Aave v3's aBasUSDC on Base (6 decimals), standing in for a LI.FI Earn USDC vault. */
export const BASE_USDC_VAULT = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";

export const reviewedBaseToSolana = (): ReviewedRoute => ({
  fromChain: "eip155:8453",
  toChain: "solana:mainnet",
  fromToken: BASE_USDC,
  toToken: SOL_USDC,
  fromAmountAtomic: ONE_USDC,
  fromAddress: EVM_WALLET,
  toAddress: SOL_WALLET,
  tool: TOOL,
  toAmountMinAtomic: MIN_RECEIVED,
});

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export function route(overrides: Partial<RouteData> = {}): RouteData {
  return {
    tool: TOOL,
    toolName: "Relay",
    toolLogoUrl: null,
    fromChain: "eip155:8453",
    toChain: "solana:mainnet",
    fromToken: { chain: "eip155:8453", address: BASE_USDC, symbol: "USDC", decimals: 6 },
    toToken: { chain: "solana:mainnet", address: SOL_USDC, symbol: "USDC", decimals: 6 },
    fromAddress: EVM_WALLET,
    toAddress: SOL_WALLET,
    fromAmountAtomic: ONE_USDC,
    toAmountAtomic: "995000",
    toAmountMinAtomic: MIN_RECEIVED,
    fromAmountUsd: "1",
    toAmountUsd: "0.995",
    gasUsd: "0.002",
    feeUsd: "0.005",
    fees: [],
    estimatedDurationS: 20,
    approvalAddress: LIFI_DIAMOND,
    steps: 1,
    rehearsal: null,
    quotedAt: new Date().toISOString(),
    expiresAt: inMinutes(2),
    ...overrides,
  };
}

/** A 1 USDC Earn deposit into BASE_USDC_VAULT on Base, as the plugin sends it; `tool` only once the person reviewed one. */
export const earnDepositBody = (tool?: string): EarnMoveRequest => ({
  chain: "eip155:8453",
  vault: BASE_USDC_VAULT,
  token: BASE_USDC,
  amountAtomic: ONE_USDC,
  fromAddress: EVM_WALLET,
  minReceivedAtomic: MIN_RECEIVED,
  ...(tool === undefined ? {} : { tool }),
});

/** The gateway's Earn deposit route: USDC → vault shares on Base, back to the sender. */
export const earnDepositRoute: Partial<RouteData> = {
  toChain: "eip155:8453",
  toToken: { chain: "eip155:8453", address: BASE_USDC_VAULT, symbol: "aBasUSDC", decimals: 6 },
  toAddress: EVM_WALLET,
};

/** LI.FI's bridge call on Base: to the Diamond, no native value, some calldata. */
export const evmTransfer = (overrides: Partial<{ chainId: number; to: string; data: string; value: string }> = {}) => ({
  chainId: 8453,
  to: LIFI_DIAMOND,
  data: "0xabcdef01",
  value: "0",
  ...overrides,
});

export function transfer(routeOverrides: Partial<RouteData> = {}, txOverrides: Parameters<typeof evmTransfer>[0] = {}): Extract<ProposalResponse, { step: "transfer" }> {
  return { step: "transfer", route: route(routeOverrides), tx: evmTransfer(txOverrides) };
}

/**
 * A legacy Solana wire transaction: signature slots, then a message whose header says `requiredSigners` and whose
 * first account key (the fee payer) is `payer`. Enough of a transaction for PayBox's checks; never signed or sent.
 */
export function solanaTx(payer: string, options: { slots?: number; requiredSigners?: number; presigned?: boolean; padTo?: number } = {}): string {
  const slots = options.slots ?? 1;
  const required = options.requiredSigners ?? 1;
  const signatures = new Uint8Array(slots * 64).fill(options.presigned ? 7 : 0);
  const payerKey = decodeBase58(payer)!;
  const systemProgram = new Uint8Array(32);
  const blockhash = new Uint8Array(32);
  const message = [required, 0, 1, 2, ...payerKey, ...systemProgram, ...blockhash, 0];
  let bytes = [slots, ...signatures, ...message];
  if (options.padTo && bytes.length < options.padTo) bytes = [...bytes, ...new Array<number>(options.padTo - bytes.length).fill(0)];
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}
