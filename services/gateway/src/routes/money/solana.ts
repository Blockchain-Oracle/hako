/**
 * Solana JSON-RPC for the money routes: `simulateTransaction` (rehearsal, Helius first, plan B13), and what
 * `/v1/broadcast` needs for a PayBox-signed transaction (the blockhash still valid, a signed re-simulation, one send).
 * Plus a reader for the signed wire format: signatures, the message the signer signed, and its recent blockhash.
 */
import {
  BASE58_ALPHABET,
  BITS_PER_BYTE,
  decodeBase64,
  readCompactU16,
  SOLANA_MESSAGE_HEADER_BYTES,
  SOLANA_PUBKEY_BYTES,
  SOLANA_SIGNATURE_BYTES,
  SOLANA_VERSIONED_FLAG,
  ZERO_UNITS,
} from "@hako/defi/core";
import { SOLANA } from "@hako/networks";

import type { SimulationOutcome } from "./evm.js";
import {
  HELIUS_KEY_PARAM,
  HELIUS_RPC_URL,
  JSON_RPC_VERSION,
  SOLANA_BLOCKHASH_BYTES,
  SOLANA_COMMITMENT,
  SOLANA_ERROR_WORDS,
} from "./money.config.js";
import { moneyEnv } from "./runtime.js";

/** Helius (HELIUS_API_KEY, plan B13) first, then Solana's public RPCs (@hako/networks): the first that answers. */
function solanaEndpoints(): string[] {
  const key = moneyEnv().HELIUS_API_KEY;
  if (!key) return [...SOLANA.rpcUrls];
  const helius = new URL(HELIUS_RPC_URL);
  helius.searchParams.set(HELIUS_KEY_PARAM, key);
  return [helius.toString(), ...SOLANA.rpcUrls];
}

/** The cluster answered with a JSON-RPC error: that is an answer, so no other endpoint is asked. */
class SolanaRpcError extends Error {}

async function solanaRpc<T>(method: string, params: unknown[], timeoutMs: number): Promise<T> {
  let lastError: unknown = new Error(`Solana ${method}: no RPC endpoint`);
  for (const url of solanaEndpoints()) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, method, params }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
      if (body?.error) throw new SolanaRpcError(`Solana ${method}: ${body.error.message ?? "error"}`);
      if (!response.ok || body?.result === undefined) throw new Error(`Solana ${method} answered HTTP ${response.status}`);
      return body.result;
    } catch (error) {
      if (error instanceof SolanaRpcError) throw error;
      // Rate-limited, down or slow (a Helius plan can run out): the next endpoint gets the same request.
      lastError = error;
    }
  }
  throw lastError;
}

interface SimulateResult {
  value: { err: unknown; logs: string[] | null };
}

/**
 * `simulateTransaction`. Unsigned (a rehearsal): signatures unchecked, the blockhash replaced so only the program logic
 * is judged. Signed (before a send): signatures verified against the transaction's own blockhash.
 */
export async function simulateSolana(transactionBase64: string, signed: boolean, timeoutMs: number): Promise<SimulationOutcome> {
  const options = { encoding: "base64", commitment: SOLANA_COMMITMENT, sigVerify: signed, replaceRecentBlockhash: !signed };
  const { value } = await solanaRpc<SimulateResult>("simulateTransaction", [transactionBase64, options], timeoutMs);
  if (value.err === null) return { ok: true };
  const known = typeof value.err === "string" ? SOLANA_ERROR_WORDS[value.err] : undefined;
  if (known) return { ok: false, reason: known };
  const lastLog = value.logs?.at(-1);
  return { ok: false, reason: `The transaction would fail (${JSON.stringify(value.err)})${lastLog ? `: ${lastLog}` : ""}` };
}

export const blockhashValid = async (blockhash: string, timeoutMs: number): Promise<boolean> =>
  (await solanaRpc<{ value: boolean }>("isBlockhashValid", [blockhash, { commitment: SOLANA_COMMITMENT }], timeoutMs)).value;

/** Sends a signed transaction; resolves to its signature. */
export const sendSolana = (transactionBase64: string, timeoutMs: number): Promise<string> =>
  solanaRpc<string>("sendTransaction", [transactionBase64, { encoding: "base64", preflightCommitment: SOLANA_COMMITMENT }], timeoutMs);

/** Whether the cluster has seen this signature (sent before, by us or anyone). */
export async function knownSignature(signature: string, timeoutMs: number): Promise<boolean> {
  try {
    const { value } = await solanaRpc<{ value: (unknown | null)[] }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }], timeoutMs);
    return value[0] !== null && value[0] !== undefined;
  } catch {
    return false;
  }
}

/** Bytes to base58 (Solana signatures, blockhashes and keys). */
export function encodeBase58(bytes: Uint8Array): string {
  const radix = BigInt(BASE58_ALPHABET.length);
  let value = ZERO_UNITS;
  for (const byte of bytes) value = (value << BigInt(BITS_PER_BYTE)) + BigInt(byte);
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

export interface SignedSolanaTransaction {
  signatures: Uint8Array[];
  /** The serialized message: what the signer signed. */
  message: Uint8Array;
  blockhash: string;
}

/** Reads a signed wire transaction; null when the bytes are not one. */
export function readSignedSolana(transactionBase64: string): SignedSolanaTransaction | null {
  const bytes = decodeBase64(transactionBase64);
  if (!bytes) return null;
  const slots = readCompactU16(bytes, 0);
  if (!slots) return null;
  const messageStart = slots.next + slots.value * SOLANA_SIGNATURE_BYTES;
  if (messageStart >= bytes.length) return null;
  const message = bytes.subarray(messageStart);
  const headerStart = (message[0]! & SOLANA_VERSIONED_FLAG) !== 0 ? 1 : 0;
  const keys = readCompactU16(message, headerStart + SOLANA_MESSAGE_HEADER_BYTES);
  if (!keys || keys.value < 1) return null;
  const blockhashStart = keys.next + keys.value * SOLANA_PUBKEY_BYTES;
  if (blockhashStart + SOLANA_BLOCKHASH_BYTES > message.length) return null;
  const signatures = Array.from({ length: slots.value }, (_, index) =>
    bytes.subarray(slots.next + index * SOLANA_SIGNATURE_BYTES, slots.next + (index + 1) * SOLANA_SIGNATURE_BYTES),
  );
  return { signatures, message, blockhash: encodeBase58(message.subarray(blockhashStart, blockhashStart + SOLANA_BLOCKHASH_BYTES)) };
}
