/**
 * `POST /v1/broadcast` (plan B13): the only sender of PayBox-signed transactions. It holds no key (R8): it relays a
 * transaction the user's PayBox wallet already signed, and only after it
 *   1. decodes it and checks it equals its draft version (money/broadcast-checks.ts),
 *   2. checks it can still land: EVM — its nonce is the sender's next one; Solana — its blockhash is still valid,
 *   3. re-simulates it at `latest` (Solana: with signature verification),
 * then sends it once, keyed by its hash (a repeat, or a node's "already known", is a no-op). A stale nonce, an expired
 * blockhash or a failing simulation is never sent: "Signed but not sent — no money moved".
 *
 * The draft version comes from the stored drafts first (`useStoredExpectations`, wired by W0.6's money intents with
 * @hako/db), else from the `draft` the caller posts (the CLI's in-process drafts, `hako_broadcast` from MCP hosts); with
 * neither, nothing is sent. W0.6's PayBox wallet-sign poller sends each `success` request through
 * `relaySignedTransaction`, the same path.
 */
import { broadcastRequestSchema, type broadcastResponseSchema, type DraftRef, GATEWAY_ENDPOINTS } from "@hako/cards/contract";
import { explorerTxUrl, type EvmNetwork, type Network, SOLANA } from "@hako/networks";
import type { Hono } from "hono";
import type { z } from "zod";

import { type BroadcastExpectation, checkEvm, checkSolana } from "./money/broadcast-checks.js";
import { callAtLatest, knownTransaction, pendingNonce, revertWords, sendRawEvm } from "./money/evm.js";
import { answer, readBody } from "./money/http.js";
import { BROADCAST_SENT_TTL_S, MONEY_WORDS, RPC_READ_TIMEOUT_MS, RPC_SEND_TIMEOUT_MS } from "./money/money.config.js";
import { executableSource } from "./money/proposals.js";
import { store } from "./money/runtime.js";
import { blockhashValid, knownSignature, sendSolana, simulateSolana } from "./money/solana.js";

export type BroadcastRequest = z.output<typeof broadcastRequestSchema>;
export type BroadcastResponse = z.output<typeof broadcastResponseSchema>;

/** The stored-draft lookup W0.6 wires (the expectation of a draft version Hako stored), or null when none is stored. */
export type StoredExpectationLookup = (ref: DraftRef) => Promise<BroadcastExpectation | null>;

let storedExpectation: StoredExpectationLookup = async () => null;

/** W0.6: point `/v1/broadcast` (and the poller) at the stored drafts of `@hako/db`. */
export function useStoredExpectations(lookup: StoredExpectationLookup): void {
  storedExpectation = lookup;
}

const refused = (detail: string, reason: string = MONEY_WORDS.notSent): BroadcastResponse => ({
  status: "refused",
  txHash: null,
  explorerUrl: null,
  reason: `${reason}: ${detail}`,
  moneyMoved: "no",
});
// Sent is on its way, not landed: the card follows it to confirmed or reverted (`/v1/chain/tx`, `/v1/bridge/status`).
const onItsWay = (network: Network, hash: string, status: "sent" | "already_known"): BroadcastResponse => ({
  status,
  txHash: hash,
  explorerUrl: explorerTxUrl(network, hash),
  reason: null,
  moneyMoved: "unknown",
});
const sentKey = (network: Network, hash: string) => `sent:${network.caip2}:${hash.toLowerCase()}`;

const ALREADY_KNOWN = /already known|already imported|alreadyprocessed|already been processed/i;

async function relayEvm(network: EvmNetwork, signedTx: string, expectation: BroadcastExpectation): Promise<BroadcastResponse> {
  const checked = await checkEvm(network, signedTx, expectation);
  if (!checked.ok) return refused(checked.reason);
  const tx = checked.tx;
  const key = sentKey(network, tx.hash);
  if (await store().get(key)) return onItsWay(network, tx.hash, "already_known");

  const next = await pendingNonce(network, tx.from);
  if (tx.nonce < next) {
    return (await knownTransaction(network, tx.hash)) ? onItsWay(network, tx.hash, "already_known") : refused(`nonce ${tx.nonce} is stale (next is ${next})`);
  }
  if (tx.nonce > next) return refused(`nonce ${tx.nonce} skips ahead of the wallet's next (${next})`);
  const simulation = await callAtLatest(network, tx.from, { to: tx.to, data: tx.data, value: tx.value }, tx.gas);
  if (!simulation.ok) return refused(`it would revert now (${simulation.reason})`);

  if (!(await store().claim(key, BROADCAST_SENT_TTL_S))) return onItsWay(network, tx.hash, "already_known");
  try {
    await sendRawEvm(network, tx.serialized, RPC_SEND_TIMEOUT_MS);
    return onItsWay(network, tx.hash, "sent");
  } catch (error) {
    if (ALREADY_KNOWN.test(revertWords(error)) || (await knownTransaction(network, tx.hash))) return onItsWay(network, tx.hash, "already_known");
    await store().release(key);
    return refused(`the network refused it (${revertWords(error)})`);
  }
}

async function relaySolana(signedTx: string, expectation: BroadcastExpectation): Promise<BroadcastResponse> {
  const checked = checkSolana(signedTx, expectation);
  if (!checked.ok) return refused(checked.reason);
  const { signature, blockhash } = checked.tx;
  const key = sentKey(SOLANA, signature);
  if (await store().get(key)) return onItsWay(SOLANA, signature, "already_known");

  if (!(await blockhashValid(blockhash, RPC_READ_TIMEOUT_MS))) {
    return (await knownSignature(signature, RPC_READ_TIMEOUT_MS))
      ? onItsWay(SOLANA, signature, "already_known")
      : refused("ask for a fresh quote", MONEY_WORDS.expiredBlockhash);
  }
  const simulation = await simulateSolana(signedTx, true, RPC_READ_TIMEOUT_MS);
  if (!simulation.ok) {
    if (ALREADY_KNOWN.test(simulation.reason)) return onItsWay(SOLANA, signature, "already_known");
    return refused(simulation.reason);
  }

  if (!(await store().claim(key, BROADCAST_SENT_TTL_S))) return onItsWay(SOLANA, signature, "already_known");
  try {
    await sendSolana(signedTx, RPC_SEND_TIMEOUT_MS);
    return onItsWay(SOLANA, signature, "sent");
  } catch (error) {
    if (ALREADY_KNOWN.test(revertWords(error)) || (await knownSignature(signature, RPC_READ_TIMEOUT_MS))) {
      return onItsWay(SOLANA, signature, "already_known");
    }
    await store().release(key);
    return refused(`the network refused it (${revertWords(error)})`);
  }
}

/**
 * The one check-and-send path for a signed transaction and the draft version it must equal (this route, and W0.6's
 * PayBox wallet-sign poller for every `success`). R17 first: only an executable chain sends.
 */
export async function relaySignedTransaction(chain: string, signedTx: string, expectation: BroadcastExpectation): Promise<BroadcastResponse> {
  const network = executableSource(chain);
  return network.family === "evm" ? relayEvm(network, signedTx, expectation) : relaySolana(signedTx, expectation);
}

export function registerBroadcast(app: Hono): void {
  app.post(GATEWAY_ENDPOINTS.broadcast.path, (c) =>
    answer(c, async () => {
      const body = await readBody(c, broadcastRequestSchema);
      const expectation = (await storedExpectation({ draftId: body.draftId, version: body.version })) ?? body.draft ?? null;
      if (!expectation) return c.json(refused("post the draft version with the signed transaction", MONEY_WORDS.noDraft));
      return c.json(await relaySignedTransaction(body.chain, body.signedTx, expectation));
    }),
  );
}
