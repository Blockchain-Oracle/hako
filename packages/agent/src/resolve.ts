import {
  type CardFix,
  caip2Schema,
  evmAddressSchema,
  solanaAddressSchema,
  type RunEnvelope,
  type RunSource,
  type TokenRef,
  type TxLink,
  type WalletRef,
} from "@hako/cards/contract";
import { AmountError, fromAtomic, sameAddress, sumAtomic, toAtomic } from "@hako/money";
import { type Caip2, isNetworkKey, NETWORKS, type NetworkFamily, networkByCaip2, type TokenInfo, explorerTxUrl } from "@hako/networks";

import type { AgentDeps, PayboxAccount, PayboxWallet } from "./deps.ts";
import { AgentToolError, authRequired, invalidInput, payboxNotConnected } from "./errors.ts";

/** Shared steps of the tools: who is calling, which chain and token the person meant, exact amounts. */

export function requireUser(deps: AgentDeps, tool: string): NonNullable<AgentDeps["user"]> {
  if (!deps.user) throw authRequired(tool);
  return deps.user;
}

export function requireAccount(deps: AgentDeps, tool: string): PayboxAccount {
  requireUser(deps, tool);
  if (!deps.account) throw payboxNotConnected();
  return deps.account;
}

/**
 * A chain as the person or the model names it: a network key ("base") or a CAIP-2 id, in Hako's canonical form. Only
 * EVM (`eip155:*`) and Solana (`solana:*`) chains: Hako reads and drafts on nothing else.
 */
export function resolveChain(value: string): Caip2 {
  const text = value.trim().toLowerCase();
  if (isNetworkKey(text)) return NETWORKS[text].caip2;
  const known = networkByCaip2(value.trim());
  if (known) return known.caip2;
  const parsed = caip2Schema.safeParse(value.trim());
  if (!parsed.success) throw invalidInput(`"${value}" is not a chain: use base, ethereum, arbitrum, optimism, polygon, solana or a CAIP-2 id.`);
  familyOf(parsed.data);
  return parsed.data;
}

/** CAIP-2 namespaces Hako works with, and their chain family. */
const FAMILY_BY_NAMESPACE: Readonly<Record<string, NetworkFamily>> = { eip155: "evm", solana: "solana" };

/** The chain family of a CAIP-2 id, from its namespace; any namespace but `eip155` and `solana` is refused. */
export function familyOf(chain: Caip2): NetworkFamily {
  const [namespace = ""] = chain.split(":");
  const family = Object.hasOwn(FAMILY_BY_NAMESPACE, namespace) ? FAMILY_BY_NAMESPACE[namespace] : undefined;
  if (!family) throw new AgentToolError("unsupported", `Hako works on EVM (eip155) and Solana chains, not ${chain}.`);
  return family;
}

const ADDRESS_SCHEMAS = { evm: evmAddressSchema, solana: solanaAddressSchema } as const satisfies Record<NetworkFamily, unknown>;

/** Whether a string is an address of the family (EVM 0x, Solana base58). */
export const isAddressOf = (family: NetworkFamily, value: string): boolean => ADDRESS_SCHEMAS[family].safeParse(value).success;

const familyWords = (family: NetworkFamily): string => (family === "evm" ? "an EVM (0x…)" : "a Solana");

const fromInfo = (chain: Caip2, info: TokenInfo): TokenRef => ({ chain, address: info.address, symbol: info.symbol, decimals: info.decimals, name: info.name });

/** The chain's native coin and USDC from @hako/networks, matched by symbol or address. */
function registryToken(chain: Caip2, query: string): TokenRef | null {
  const network = networkByCaip2(chain);
  if (!network) return null;
  for (const info of [network.native, network.usdc]) {
    if (info.symbol.toLowerCase() === query.toLowerCase() || sameAddress(info.address, query)) return fromInfo(network.caip2, info);
  }
  return null;
}

type NotFoundData = { found: false; message: string };

/** The run envelope's data, or a not-found error in the tool's words ("nothing found" settles at zero). */
export function dataOf<D>(envelope: { found: boolean; data: D }, what: string): Exclude<D, NotFoundData> {
  if (!envelope.found) {
    const message = (envelope.data as Partial<NotFoundData>).message;
    throw new AgentToolError("not_found", message ?? `No ${what} found.`);
  }
  return envelope.data as Exclude<D, NotFoundData>;
}

/** A token by symbol or address on a chain: the registry first (native coin, USDC), then the gateway's token read. */
export async function resolveToken(deps: Pick<AgentDeps, "gateway">, chain: Caip2, query: string): Promise<TokenRef> {
  const known = registryToken(chain, query.trim());
  if (known) return known;
  const envelope = await deps.gateway.call("chainToken", { body: { chain, token: query.trim() } });
  const token = dataOf(envelope, `token "${query}" on ${chain}`);
  return { chain: token.chain, address: token.address, symbol: token.symbol, decimals: token.decimals, name: token.name };
}

/** An exact amount in atomic units, refusing more decimals than the token has instead of rounding. */
export function atomicAmount(decimal: string, token: TokenRef): string {
  try {
    return toAtomic(decimal, token.decimals).toString();
  } catch (error) {
    if (error instanceof AmountError) throw invalidInput(`${decimal} is not an amount of ${token.symbol} (${token.decimals} decimals at most).`);
    throw error;
  }
}

/** Exact USD sum of decimal strings; null when any part is unknown (no made-up totals). */
export function sumUsd(values: readonly (string | null)[]): string | null {
  if (values.some((value) => value === null)) return null;
  const decimals = Math.max(0, ...values.map((value) => (value as string).split(".")[1]?.length ?? 0));
  return fromAtomic(sumAtomic(values.map((value) => toAtomic(value as string, decimals))), decimals);
}

/** An atomic amount above zero (any non-zero digit). */
export const isPositiveAtomic = (atomic: string): boolean => /[1-9]/.test(atomic);

/** The user's granted PayBox wallet for a chain family (the one PayBox signs with), or a named fix. */
export async function walletFor(account: PayboxAccount, family: NetworkFamily): Promise<PayboxWallet> {
  const { wallets } = await account.credentials();
  const wallet = wallets.find((candidate) => candidate.family === family);
  if (!wallet) {
    const fix: CardFix = "raise_limit";
    throw new AgentToolError("unsupported", `No ${family === "evm" ? "EVM" : "Solana"} wallet is shared with Hako in PayBox yet.`, fix);
  }
  return wallet;
}

export const walletRef = (wallet: Pick<PayboxWallet, "address" | "family" | "name">): WalletRef => ({
  address: wallet.address,
  family: wallet.family,
  label: wallet.name,
});

/**
 * The sending address: the one given, else the user's PayBox wallet for the chain's family. A given address must be of
 * the chain's family; a signed-in user's must also be one of the wallets they shared with Hako (PayBox signs only
 * with those). An anonymous caller may draft from any address of the right family (nothing runs until sign-in).
 */
export async function senderFor(deps: AgentDeps, chain: Caip2, given: string | undefined, tool: string): Promise<WalletRef> {
  const family = familyOf(chain);
  if (given !== undefined) {
    if (!isAddressOf(family, given)) throw invalidInput(`${given} is not ${familyWords(family)} address, so it can't send on ${chain}.`);
    if (!deps.user) return { address: given, family };
    const { wallets } = await requireAccount(deps, tool).credentials();
    const own = wallets.find((wallet) => wallet.family === family && sameAddress(wallet.address, given));
    if (!own) throw invalidInput(`${given} isn't a wallet you shared with Hako in PayBox: drafts send from your own PayBox wallets.`);
    return walletRef(own);
  }
  if (!deps.user) {
    throw new AgentToolError("auth_required", `Connect PayBox so ${tool} can draft from your wallet, or say which address sends.`, "connect_paybox");
  }
  return walletRef(await walletFor(requireAccount(deps, tool), family));
}

/** A recipient: an address of the chain's family, a saved contact, or a PayBox username. */
export async function resolveRecipient(deps: AgentDeps, to: string, chain: Caip2): Promise<WalletRef> {
  const family = familyOf(chain);
  if (isAddressOf(family, to)) return { address: to, family };
  const otherFamily: NetworkFamily = family === "evm" ? "solana" : "evm";
  if (isAddressOf(otherFamily, to)) throw invalidInput(`${to} is not ${familyWords(family)} address, so it can't receive on ${chain}.`);
  const contact = await deps.contacts?.find(to);
  if (contact) {
    if (contact.family !== family) throw invalidInput(`${contact.name} is saved with a ${contact.family} address, not one for ${chain}.`);
    return { address: contact.address, family, label: contact.name };
  }
  const user = deps.account ? await deps.account.resolveUsername(to) : null;
  const address = user ? user[family] : null;
  if (address) return { address, family, label: to };
  throw invalidInput(`I don't know who "${to}" is: give their address, a saved contact's name or their PayBox username.`);
}

/** The safe metadata of a catalog run envelope, for `envelope.source`. */
export function sourceOf(envelope: RunEnvelope): RunSource {
  return {
    endpoint: envelope.endpoint,
    provider: envelope.provider,
    found: envelope.found,
    billable: envelope.billable,
    cached: envelope.cached,
    asOf: envelope.as_of,
    elapsedMs: envelope.elapsed_ms,
    price: envelope.price ?? null,
    notes: envelope.notes,
    sources: envelope.sources,
  };
}

/** A transaction link with its explorer URL when Hako knows the chain. */
export function txLink(chain: Caip2, hash: string, role: TxLink["role"]): TxLink {
  const network = networkByCaip2(chain);
  return { chain, hash, role, explorerUrl: network ? explorerTxUrl(network, hash) : null };
}
