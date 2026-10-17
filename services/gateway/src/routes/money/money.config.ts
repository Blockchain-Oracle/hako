/**
 * The gateway money routes' own numbers and names (plan B13; plan §5b: feature-local numbers live in a `*.config.ts`).
 * Shared timeouts and TTLs (LIFI_TIMEOUT_MS, REHEARSAL_TIMEOUT_MS, QUOTE_CACHE_TTL_S, the route-race budgets) come from
 * @hako/config.
 */
import { PROPOSAL_EXPIRY_LIMIT_S, SECONDS_PER_DAY, SECONDS_PER_HOUR } from "@hako/config";
import type { StatusMessage } from "@lifi/types";

/**
 * Route-race contenders when the caller names none (plan add-ons "Route race"): LI.FI bridge keys from
 * https://li.quest/v1/tools (2026-10-17) that move USDC between EVM chains and Solana. On 2026-10-17 a Base → Solana
 * 1 USDC quote came back from `relaydepository` and `mayanFastMCTP`; the others answer larger or EVM-only moves.
 */
export const RACE_BRIDGES = ["relaydepository", "mayanFastMCTP", "mayan", "across", "cctp", "stargateV2", "near", "eco"] as const;
/** Same-chain swaps pin `allowExchanges=[tool]`: LI.FI exchange keys per chain family (li.quest/v1/tools). */
export const RACE_EVM_EXCHANGES = ["lifidexaggregator", "1inch", "okx", "kyberswap", "paraswap", "sushiswap"] as const;
export const RACE_SOLANA_EXCHANGES = ["jupiter", "okx", "dflow", "titan"] as const;

/** LI.FI's tool list (each race row's name and logo) and token facts change rarely: re-read hourly. */
export const LIFI_TOOLS_TTL_S = SECONDS_PER_HOUR;
export const TOKEN_FACTS_TTL_S = SECONDS_PER_HOUR;
/** A rehearsal belongs to one immutable draft version; it is kept as long as a proposal can live. */
export const REHEARSAL_CACHE_TTL_S = PROPOSAL_EXPIRY_LIMIT_S;
/** `/v1/broadcast` remembers each sent transaction this long, so a repeat is a no-op ("already known"). */
export const BROADCAST_SENT_TTL_S = SECONDS_PER_DAY;

/** Every cache key the money routes write starts here (Redis is shared with the batch and invoice routes). */
export const CACHE_KEY_PREFIX = "hako:gateway:money:";
/** The in-memory cache (no REDIS_URL) drops its oldest entry beyond this many. */
export const MEMORY_CACHE_MAX_ENTRIES = 2_000;

/** One on-chain read (an allowance, a nonce, a fee) through the public RPCs of @hako/networks. */
export const RPC_READ_TIMEOUT_MS = 2_000;
/** Sending a signed transaction: the node answers with its hash or a rejection. */
export const RPC_SEND_TIMEOUT_MS = 5_000;

/** Helius (plan B13: Solana `simulateTransaction`): the key travels as this query parameter. */
export const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/";
export const HELIUS_KEY_PARAM = "api-key";
/** Solana JSON-RPC commitment for simulation, blockhash checks and sends. */
export const SOLANA_COMMITMENT = "confirmed";
export const JSON_RPC_VERSION = "2.0";
/** A Solana message's recent blockhash (protocol fact). */
export const SOLANA_BLOCKHASH_BYTES = 32;
/**
 * The DER (SubjectPublicKeyInfo) header of an ed25519 public key (RFC 8410): prefixed to a Solana signer's raw 32
 * bytes so node:crypto can verify a signature with it.
 */
export const ED25519_SPKI_PREFIX_HEX = "302a300506032b6570032100";
/** An EVM address is 20 bytes: 40 hex characters at the low end of an ABI word. */
export const ADDRESS_HEX_CHARS = 40;

/** LI.FI answers a rate-limited caller with 429; 5xx is its own failure (anything 4xx below it is our input). */
export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_SERVER_ERROR = 500;

/** `/v1/routes` streams one JSON snapshot per line, never cached by a proxy. */
export const NDJSON_CONTENT_TYPE = "application/x-ndjson";
export const NO_STORE = "no-store";

/** LI.FI's transfer status in the contract's words (`INVALID`: the hash is not a transfer of that tool). */
export const LIFI_STATUS_WORDS: Readonly<Record<StatusMessage, "pending" | "done" | "failed" | "not_found">> = {
  PENDING: "pending",
  DONE: "done",
  FAILED: "failed",
  NOT_FOUND: "not_found",
  INVALID: "not_found",
};

/** A quote is one transaction (LI.FI `/quote`): the only kind of route Hako offers. */
export const SINGLE_TRANSACTION_STEPS = 1;
/** Gas is paid on top of the amount sent, so its fee line is never `included`. */
export const GAS_FEE_NAME = "Gas";
/** A LI.FI fee cost without a name of its own. */
export const FEE_FALLBACK_NAME = "Route fee";

/** Words the cards show (plan §1 card flow: every state said in words). */
export const MONEY_WORDS = {
  notSent: "Signed but not sent — no money moved",
  noDraft: "No draft version to check this transaction against, so it was not sent — no money moved",
  expiredBlockhash: "Signature expired before sending — no money moved",
  notRehearsed: (chain: string) => `Not rehearsed on ${chain}`,
  overBudget: (ms: number) => `Rehearsal took longer than ${ms} ms, so the quote comes back without it`,
  noSingleTx: "No single-transaction route",
  noAnswer: (seconds: number) => `No answer within ${seconds} s`,
} as const;
