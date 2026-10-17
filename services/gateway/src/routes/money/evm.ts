/**
 * EVM reads and sends for the money routes, over the public RPCs @hako/networks lists (no Alchemy, plan §11): the
 * allowance R16 reads, `eth_simulateV1` rehearsals (viem `simulateCalls`), and what `/v1/broadcast` needs (the pending
 * nonce, a re-simulation at `latest`, the one `eth_sendRawTransaction`). No key ever: the gateway only relays
 * transactions the user's PayBox wallet signed (R8).
 */
import type { EvmNetwork } from "@hako/networks";
import { type Address, createPublicClient, erc20Abi, fallback, type Hash, type Hex, http, isAddress } from "viem";

import { RPC_READ_TIMEOUT_MS } from "./money.config.js";

const makeClient = (network: EvmNetwork, timeoutMs: number) =>
  createPublicClient({ transport: fallback(network.rpcUrls.map((url) => http(url, { timeout: timeoutMs, retryCount: 0 }))) });
type EvmClient = ReturnType<typeof makeClient>;

const clients = new Map<string, EvmClient>();

/** One client per network and time budget (reads, rehearsals and sends have different budgets). */
export function evmClient(network: EvmNetwork, timeoutMs: number = RPC_READ_TIMEOUT_MS): EvmClient {
  const key = `${network.key}:${timeoutMs}`;
  let client = clients.get(key);
  if (!client) {
    client = makeClient(network, timeoutMs);
    clients.set(key, client);
  }
  return client;
}

export const asAddress = (value: string): Address | null => (isAddress(value, { strict: false }) ? (value as Address) : null);

/** `allowance(owner, spender)` right now, or null when it couldn't be read (R16 then refuses: "allowance_unknown"). */
export async function readAllowance(network: EvmNetwork, token: Address, owner: Address, spender: Address): Promise<string | null> {
  try {
    const value = await evmClient(network).readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
    return value.toString();
  } catch (error) {
    console.warn(JSON.stringify({ event: "allowance_unreadable", chain: network.caip2, error: String(error) }));
    return null;
  }
}

export interface EvmCall {
  to: Address;
  data: Hex;
  value: bigint;
}

export type SimulationOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Short words for a revert or an RPC refusal: viem's `shortMessage` when it has one, down to its last line (where the
 * contract's own reason sits, e.g. "ERC20: transfer amount exceeds balance").
 */
export function revertWords(error: unknown): string {
  const text = error instanceof Error ? ((error as Error & { shortMessage?: string }).shortMessage ?? error.message) : String(error);
  return text.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? text;
}

/** `eth_simulateV1`: the calls run in order from `from`, each seeing the one before (approve + transfer together). */
export async function simulateEvmCalls(network: EvmNetwork, from: Address, calls: readonly EvmCall[], timeoutMs: number): Promise<SimulationOutcome> {
  const { results } = await evmClient(network, timeoutMs).simulateCalls({ account: from, calls: calls.map((call) => ({ ...call })) });
  const failedAt = results.findIndex((result) => result.status === "failure");
  if (failedAt === -1) return { ok: true };
  const failed = results[failedAt];
  const words = failed && "error" in failed && failed.error ? revertWords(failed.error) : "the call reverted";
  return { ok: false, reason: `Call ${failedAt + 1} of ${calls.length} would revert: ${words}` };
}

/** The sender's next nonce, counting transactions already in the mempool. */
export const pendingNonce = (network: EvmNetwork, address: Address): Promise<number> =>
  evmClient(network).getTransactionCount({ address, blockTag: "pending" });

/** True when the node already knows this transaction (sent before, by us or anyone). */
export async function knownTransaction(network: EvmNetwork, hash: Hash): Promise<boolean> {
  try {
    await evmClient(network).getTransaction({ hash });
    return true;
  } catch {
    return false;
  }
}

/** One `eth_call` at `latest` from the sender: the signed transaction, re-run just before it is sent. */
export async function callAtLatest(network: EvmNetwork, from: Address, call: EvmCall, gas: bigint): Promise<SimulationOutcome> {
  try {
    await evmClient(network).call({ account: from, to: call.to, data: call.data, value: call.value, gas, blockTag: "latest" });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: revertWords(error) };
  }
}

export const sendRawEvm = (network: EvmNetwork, serialized: Hex, timeoutMs: number): Promise<Hash> =>
  evmClient(network, timeoutMs).sendRawTransaction({ serializedTransaction: serialized });
