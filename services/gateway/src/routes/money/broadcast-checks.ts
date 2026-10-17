/**
 * `/v1/broadcast`'s decode-and-check (plan B13): a PayBox-signed transaction is sent only when it equals the draft
 * version it was signed for. Pure checks over the signed bytes and the expectation — nothing here reads a chain.
 *   EVM: chainId, from (recovered from the signature), to, data and value equal the draft's transaction; a LI.FI move
 *        (swap, bridge, Earn) may only target LI.FI's allowlist, or be R16's exact approve of the reviewed amount to an
 *        allowlisted spender on the reviewed token.
 *   Solana: one signature slot and one required signer, at most 1,232 bytes, the fee payer is the expected signer, the
 *        message is byte-for-byte the expected one, and the signature verifies over it (ed25519).
 */
import { createPublicKey, verify } from "node:crypto";

import { SOLANA_TX_MAX_BYTES, SOLANA_TX_REQUIRED_SIGNERS } from "@hako/config";
import type { broadcastExpectationSchema } from "@hako/cards/contract";
import {
  ABI_WORD_HEX_CHARS,
  decodeBase58,
  decodeBase64,
  ERC20_APPROVE_SELECTOR,
  erc20ApproveCalldata,
  inspectSolanaTransaction,
  ZERO_UNITS,
} from "@hako/defi/server";
import { sameAddress } from "@hako/money";
import { type EvmNetwork, isLifiContract, networkByCaip2 } from "@hako/networks";
import { type Address, type Hash, type Hex, isHex, keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import type { z } from "zod";

import { ADDRESS_HEX_CHARS, ED25519_SPKI_PREFIX_HEX } from "./money.config.js";
import { encodeBase58, readSignedSolana } from "./solana.js";

export type BroadcastExpectation = z.output<typeof broadcastExpectationSchema>;

export interface DecodedEvm {
  hash: Hash;
  serialized: Hex;
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  nonce: number;
  gas: bigint;
}

export interface DecodedSolana {
  signature: string;
  blockhash: string;
}

export type Checked<T> = { ok: true; tx: T } | { ok: false; reason: string };

const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** The reviewed move's source chain, spent token and amount (a bridge or swap route, or an Earn move). */
function reviewedSource(expectation: BroadcastExpectation): { chain: string; token: string; amount: string } | null {
  const reviewed = expectation.reviewed;
  if (!reviewed) return null;
  if ("fromToken" in reviewed) return { chain: reviewed.fromChain, token: reviewed.fromToken, amount: reviewed.fromAmountAtomic };
  return { chain: reviewed.chain, token: expectation.kind === "earn_withdraw" ? reviewed.vault : reviewed.token, amount: reviewed.amountAtomic };
}

/** R16 on the signed approve: exactly the reviewed amount, on the reviewed token, to a spender on LI.FI's allowlist. */
function exactApprove(network: EvmNetwork, expectation: BroadcastExpectation, to: Address, data: Hex): boolean {
  const source = reviewedSource(expectation);
  if (!source || !sameAddress(to, source.token) || !data.startsWith(ERC20_APPROVE_SELECTOR)) return false;
  // The spender is the low 20 bytes of the first ABI word: rebuild the exact calldata for it and compare.
  const word = data.slice(ERC20_APPROVE_SELECTOR.length, ERC20_APPROVE_SELECTOR.length + ABI_WORD_HEX_CHARS);
  const spender = `0x${word.slice(-ADDRESS_HEX_CHARS)}`;
  if (!isLifiContract(network.key, spender)) return false;
  try {
    return erc20ApproveCalldata(spender, BigInt(source.amount)) === data;
  } catch {
    return false;
  }
}

/** Decodes and checks a signed EVM transaction against its draft version (see the module comment). */
export async function checkEvm(network: EvmNetwork, signedTx: string, expectation: BroadcastExpectation): Promise<Checked<DecodedEvm>> {
  if (expectation.tx.family !== "evm") return refuse("The draft is a Solana transaction, not an EVM one.");
  if (!isHex(signedTx)) return refuse("The signed transaction is not 0x hex.");
  let parsed;
  let from: Address;
  try {
    parsed = parseTransaction(signedTx);
    from = await recoverTransactionAddress({ serializedTransaction: signedTx as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] });
  } catch {
    return refuse("The signed transaction could not be decoded, or carries no signature.");
  }
  const want = expectation.tx;
  if (parsed.chainId !== network.chainId || want.chainId !== network.chainId) return refuse(`The transaction is not for ${network.name}.`);
  if (!sameAddress(from, want.from)) return refuse("The transaction was signed by a different wallet than the draft's.");
  if (!parsed.to || !sameAddress(parsed.to, want.to)) return refuse("The transaction calls a different contract than the draft's.");
  const data = (parsed.data ?? "0x").toLowerCase() as Hex;
  if (data !== want.data.toLowerCase()) return refuse("The transaction's calldata differs from the draft's.");
  const value = parsed.value ?? ZERO_UNITS;
  if (value !== BigInt(want.value)) return refuse("The transaction sends a different native amount than the draft's.");
  if (expectation.kind !== "send") {
    const source = reviewedSource(expectation);
    if (!source) return refuse("A LI.FI move needs its reviewed route to be checked.");
    if (networkByCaip2(source.chain)?.caip2 !== network.caip2) return refuse(`The reviewed move does not start on ${network.name}.`);
    if (!isLifiContract(network.key, parsed.to) && !exactApprove(network, expectation, parsed.to, data)) {
      return refuse("A LI.FI move may only call LI.FI's allowlisted contract, or approve exactly the reviewed amount to it.");
    }
  }
  if (parsed.nonce === undefined || parsed.gas === undefined) return refuse("The transaction carries no nonce or gas limit.");
  return {
    ok: true,
    tx: { hash: keccak256(signedTx), serialized: signedTx, from, to: parsed.to, data, value, nonce: parsed.nonce, gas: parsed.gas },
  };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** ed25519 over the message with the signer's raw 32-byte key (wrapped as SPKI DER for node:crypto). */
function signatureVerifies(signer: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from(ED25519_SPKI_PREFIX_HEX, "hex"), signer]), format: "der", type: "spki" });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/** Decodes and checks a signed Solana transaction against its draft version (see the module comment). */
export function checkSolana(signedTx: string, expectation: BroadcastExpectation): Checked<DecodedSolana> {
  const want = expectation.tx;
  if (want.family !== "solana") return refuse("The draft is an EVM transaction, not a Solana one.");
  const read = readSignedSolana(signedTx);
  const summary = inspectSolanaTransaction(signedTx);
  if (!read || !summary) return refuse("The signed Solana transaction could not be read.");
  if (summary.size > SOLANA_TX_MAX_BYTES) return refuse(`The transaction is ${summary.size} bytes; PayBox takes at most ${SOLANA_TX_MAX_BYTES}.`);
  if (summary.signatureSlots !== SOLANA_TX_REQUIRED_SIGNERS || summary.requiredSigners !== SOLANA_TX_REQUIRED_SIGNERS) {
    return refuse("The transaction needs more than one signer.");
  }
  const signer = decodeBase58(want.signer);
  if (!signer || !sameBytes(signer, summary.feePayer)) return refuse("The transaction's signer is not the draft's wallet.");
  const expectedMessage = decodeBase64(want.messageBase64);
  if (!expectedMessage || !sameBytes(expectedMessage, read.message)) return refuse("The signed message differs from the draft's.");
  const signature = read.signatures[0]!;
  if (!signatureVerifies(signer, read.message, signature)) return refuse("The signature does not verify for the draft's wallet.");
  return { ok: true, tx: { signature: encodeBase58(signature), blockhash: read.blockhash } };
}
