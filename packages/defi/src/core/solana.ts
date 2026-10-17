/**
 * Reads the parts of a Solana wire transaction PayBox's rules care about (plan §2 plugin limits, R15): size, version,
 * signature slots, required signers and the fee payer. Pure functions over bytes; nothing is signed or sent.
 */
import {
  BASE58_ALPHABET,
  BITS_PER_BYTE,
  BYTE_MASK,
  COMPACT_U16_CONTINUATION,
  COMPACT_U16_DATA_BITS,
  COMPACT_U16_DATA_MASK,
  COMPACT_U16_MAX_BYTES,
  SOLANA_MESSAGE_HEADER_BYTES,
  SOLANA_PUBKEY_BYTES,
  SOLANA_SIGNATURE_BYTES,
  SOLANA_SUPPORTED_VERSIONS,
  SOLANA_VERSION_MASK,
  SOLANA_VERSIONED_FLAG,
  ZERO_UNITS,
} from "./wire.config.ts";

/** Canonical padded base64 to bytes, or null when the text is not canonical base64. */
export function decodeBase64(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  // Canonical only: re-encoding must give the same text back (no whitespace, no missing padding).
  return btoa(binary) === text ? bytes : null;
}

/** A base58 string (a Solana address) to bytes, or null when it has a character outside the alphabet. */
export function decodeBase58(text: string): Uint8Array | null {
  if (text.length === 0) return null;
  let value = 0n;
  const radix = BigInt(BASE58_ALPHABET.length);
  for (const char of text) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * radix + BigInt(digit);
  }
  const body: number[] = [];
  while (value > ZERO_UNITS) {
    body.unshift(Number(value & BigInt(BYTE_MASK)));
    value >>= BigInt(BITS_PER_BYTE);
  }
  // Each leading "1" is a leading zero byte.
  let zeros = 0;
  while (zeros < text.length && text[zeros] === BASE58_ALPHABET[0]) zeros += 1;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
}

/** A compact-u16 at `offset`: its value and the offset after it, or null when truncated or over-long. */
export function readCompactU16(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  for (let index = 0; index < COMPACT_U16_MAX_BYTES; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) return null;
    value |= (byte & COMPACT_U16_DATA_MASK) << (COMPACT_U16_DATA_BITS * index);
    if ((byte & COMPACT_U16_CONTINUATION) === 0) return { value, next: offset + index + 1 };
  }
  return null;
}

export interface SolanaTransactionSummary {
  /** Decoded size in bytes. */
  size: number;
  /** "legacy" or the versioned message's version number. */
  version: "legacy" | number;
  /** Signature slots in the envelope. */
  signatureSlots: number;
  /** The message header's required signatures. */
  requiredSigners: number;
  /** True when any signature slot is already filled (a pre-signed payload). */
  presigned: boolean;
  /** Account key 0: the fee payer and first signer. */
  feePayer: Uint8Array;
}

/** Parses a wire transaction's envelope and message header; null when the bytes are not a transaction. */
export function inspectSolanaTransaction(transactionBase64: string): SolanaTransactionSummary | null {
  const bytes = decodeBase64(transactionBase64);
  if (!bytes) return null;
  const slots = readCompactU16(bytes, 0);
  if (!slots) return null;
  const messageStart = slots.next + slots.value * SOLANA_SIGNATURE_BYTES;
  if (messageStart >= bytes.length) return null;
  const signatures = bytes.subarray(slots.next, messageStart);
  const first = bytes[messageStart]!;
  const versioned = (first & SOLANA_VERSIONED_FLAG) !== 0;
  const headerStart = versioned ? messageStart + 1 : messageStart;
  if (headerStart + SOLANA_MESSAGE_HEADER_BYTES > bytes.length) return null;
  const keys = readCompactU16(bytes, headerStart + SOLANA_MESSAGE_HEADER_BYTES);
  if (!keys || keys.value < 1 || keys.next + SOLANA_PUBKEY_BYTES > bytes.length) return null;
  return {
    size: bytes.length,
    version: versioned ? first & SOLANA_VERSION_MASK : "legacy",
    signatureSlots: slots.value,
    requiredSigners: bytes[headerStart]!,
    presigned: signatures.some((byte) => byte !== 0),
    feePayer: bytes.subarray(keys.next, keys.next + SOLANA_PUBKEY_BYTES),
  };
}

export type SolanaCheckReason =
  | "solana_malformed"
  | "solana_too_large"
  | "solana_unsupported_version"
  | "solana_signer_count"
  | "solana_presigned"
  | "solana_signer_not_sender";

export type SolanaCheck = { ok: true; summary: SolanaTransactionSummary } | { ok: false; reason: SolanaCheckReason; message: string };

/**
 * PayBox's Solana proposal rules, failing closed: at most `maxBytes`, legacy or v0, exactly `requiredSigners`
 * signature slots and required signers, every slot empty, and the fee payer (the one signer) is `sender`.
 */
export function checkSolanaTransaction(
  transactionBase64: string,
  sender: string,
  limits: { maxBytes: number; requiredSigners: number },
): SolanaCheck {
  const summary = inspectSolanaTransaction(transactionBase64);
  if (!summary) return { ok: false, reason: "solana_malformed", message: "The Solana transaction could not be read." };
  if (summary.size > limits.maxBytes) {
    return { ok: false, reason: "solana_too_large", message: `The Solana transaction is ${summary.size} bytes; PayBox takes at most ${limits.maxBytes}.` };
  }
  if (summary.version !== "legacy" && !SOLANA_SUPPORTED_VERSIONS.includes(summary.version)) {
    return { ok: false, reason: "solana_unsupported_version", message: `Solana transaction version ${summary.version} is not supported (legacy or v0 only).` };
  }
  if (summary.requiredSigners !== limits.requiredSigners || summary.signatureSlots !== limits.requiredSigners) {
    return { ok: false, reason: "solana_signer_count", message: `The Solana transaction needs ${summary.requiredSigners} signers; PayBox takes exactly ${limits.requiredSigners}.` };
  }
  if (summary.presigned) return { ok: false, reason: "solana_presigned", message: "The Solana transaction is already partly signed." };
  const expected = decodeBase58(sender);
  const matches = expected !== null && expected.length === SOLANA_PUBKEY_BYTES && expected.every((byte, index) => byte === summary.feePayer[index]);
  if (!matches) return { ok: false, reason: "solana_signer_not_sender", message: "The Solana transaction's signer is not the sending wallet." };
  return { ok: true, summary };
}
