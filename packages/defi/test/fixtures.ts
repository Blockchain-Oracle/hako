// Test inputs for R15/R16 (plan §12): a Base USDC → Solana USDC route shaped like the live LI.FI quote of S00
// (polymerStandard via LI.FI's Diamond), and Solana wire transactions built byte by byte.
import { BASE, LIFI_DIAMOND, SOLANA } from "@hako/networks";

import { BASE58_ALPHABET, BITS_PER_BYTE, BYTE_MASK, SOLANA_PUBKEY_BYTES, SOLANA_SIGNATURE_BYTES, SOLANA_VERSIONED_FLAG, ZERO_UNITS } from "../src/core/wire.config.ts";
import type { NormalizedQuote, ReviewedRoute } from "../src/core/index.ts";

export const EVM_SENDER = "0x92a3d3e85c701e00ea48998116c94bc0ee4bbf0a";
export const SOL_RECIPIENT = "4UsEm6dVRdLuiZs2Y44bcPcUpce3nEfppXRVZZprVR5r";
export const AMOUNT = "1000000";
export const REVIEWED_MIN = "990000";
export const BRIDGE_CALLDATA ="0x1794958f0000000000000000000000000000000000000000000000000000000000000020";

export const reviewedBridge: ReviewedRoute = {
  fromChain: BASE.caip2,
  toChain: SOLANA.caip2,
  fromToken: BASE.usdc.address,
  toToken: SOLANA.usdc.address,
  fromAmountAtomic: AMOUNT,
  fromAddress: EVM_SENDER,
  toAddress: SOL_RECIPIENT,
  tool: "polymerStandard",
  toAmountMinAtomic: REVIEWED_MIN,
};

export function freshBridgeQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    id: "step-1",
    tool: "polymerStandard",
    toolName: "Polymer",
    toolLogoUri: null,
    fromChainId: BASE.lifiChainId,
    toChainId: SOLANA.lifiChainId,
    fromChain: BASE.caip2,
    toChain: SOLANA.caip2,
    // LI.FI answers with checksummed addresses; R15 compares EVM addresses case-insensitively.
    fromToken: { address: BASE.usdc.address, symbol: "USDC", decimals: 6, priceUsd: "1", logoUri: null },
    toToken: { address: SOLANA.usdc.address, symbol: "USDC", decimals: 6, priceUsd: "1", logoUri: null },
    fromAddress: "0x92A3D3E85C701E00EA48998116C94BC0EE4BBF0A",
    toAddress: SOL_RECIPIENT,
    fromAmountAtomic: AMOUNT,
    toAmountAtomic: "995000",
    toAmountMinAtomic: REVIEWED_MIN,
    feeUsd: "0.02",
    gasUsd: "0.01",
    estimatedDurationS: 1080,
    approvalAddress: LIFI_DIAMOND,
    transaction: { family: "evm", chainId: BASE.chainId, to: LIFI_DIAMOND, from: EVM_SENDER, data: BRIDGE_CALLDATA, value: "0", gasLimit: "400000" },
    quotedAt: "2026-10-17T12:00:00.000Z",
    expiresAt: "2026-10-17T12:00:15.000Z",
    ...overrides,
  };
}

/** Base58 for a byte string (test-side only: core decodes, it never encodes). */
export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << BigInt(BITS_PER_BYTE)) | BigInt(byte);
  const radix = BigInt(BASE58_ALPHABET.length);
  let text = "";
  while (value > ZERO_UNITS) {
    text = BASE58_ALPHABET[Number(value % radix)] + text;
    value /= radix;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = BASE58_ALPHABET[0] + text;
  }
  return text;
}

/** Distinct, deterministic 32-byte keys per seed. */
const KEY_STRIDE = 7;
export function keyBytes(seed: number): Uint8Array {
  return Uint8Array.from({ length: SOLANA_PUBKEY_BYTES }, (_, index) => (seed + index * KEY_STRIDE) & BYTE_MASK);
}

export interface WireOptions {
  /** Signature slots in the envelope (default 1). */
  slots?: number;
  /** The message header's required signers (default 1). */
  requiredSigners?: number;
  /** "legacy" or a version number (v0 = 0). */
  version?: "legacy" | number;
  feePayer?: Uint8Array;
  /** Extra account keys after the fee payer, to grow the transaction. */
  extraKeys?: number;
  /** Fill the first signature slot (a pre-signed payload). */
  presigned?: boolean;
}

/** A minimal Solana wire transaction (no instructions), base64. Sizes stay under 128 so compact-u16 is one byte. */
export function solanaTx(options: WireOptions = {}): string {
  const slots = options.slots ?? 1;
  const keys = [options.feePayer ?? keyBytes(1), ...Array.from({ length: options.extraKeys ?? 1 }, (_, index) => keyBytes(index + 2))];
  const bytes: number[] = [slots];
  for (let slot = 0; slot < slots; slot += 1) bytes.push(...new Array<number>(SOLANA_SIGNATURE_BYTES).fill(options.presigned && slot === 0 ? 1 : 0));
  const version = options.version ?? "legacy";
  if (version !== "legacy") bytes.push(SOLANA_VERSIONED_FLAG | version);
  bytes.push(options.requiredSigners ?? 1, 0, 1);
  bytes.push(keys.length);
  for (const key of keys) bytes.push(...key);
  bytes.push(...new Array<number>(SOLANA_PUBKEY_BYTES).fill(0)); // recent blockhash (PayBox replaces it)
  bytes.push(0); // no instructions
  if (version !== "legacy") bytes.push(0); // no address table lookups
  return btoa(String.fromCharCode(...bytes));
}
