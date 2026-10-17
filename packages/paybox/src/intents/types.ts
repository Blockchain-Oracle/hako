/**
 * The money-intent interface (plan §5b row `@hako/paybox`, W0.6): the one money core every surface calls. L4's route
 * handlers, L5's MCP tools and L6's CLI verbs go through these four functions; a second implementation fails review.
 * The draft store and the PayBox caller are passed in (server: @hako/db and the encrypted token store; CLI: an
 * in-process store and its local PayboxClient), so the same intents run in the web server, the gateway and the CLI.
 * Types only: W0.6 implements `createMoneyIntents` on top of them.
 */
import type { CardPhase, IntentState, PayboxRequestStatus } from "@hako/cards/contract";
import type { Caip2 } from "@hako/networks";

/** Atomic amounts travel as base-10 integer strings (JSON-safe), never floats: "1000000" is 1 USDC. */
export type AtomicString = string;
/** An ISO 8601 timestamp. */
export type IsoTime = string;

/** A send: ERC-20 `transfer` (or native value) / SPL transfer, through PayBox `request_transfer` (plan D25, J9). */
export interface SendInput {
  chain: Caip2;
  /** Token contract or mint; the network's native address for the native coin (@hako/networks). */
  token: string;
  amountAtomic: AtomicString;
  /** The sending wallet's address, read from PayBox `list_credentials`. */
  from: string;
  /** The resolved recipient address (a contact or a PayBox username is resolved before the draft). */
  to: string;
  /** What the user called the recipient ("Tobi", "tobi.paybox"), shown beside the address. */
  toLabel?: string;
}

/** A LI.FI swap (same chain) or bridge (two chains): R15 binds every field of it (plan A6, §1 A). */
export interface RouteInput {
  fromChain: Caip2;
  toChain: Caip2;
  fromToken: string;
  toToken: string;
  fromAmountAtomic: AtomicString;
  fromAddress: string;
  toAddress: string;
  /** The LI.FI tool (bridge or exchange key) picked in the route race; every later quote pins `allowBridges=[tool]`. */
  tool?: string;
}

/** LI.FI Earn / Composer deposit or withdraw (EVM; plan A8, J3). */
export interface EarnInput {
  chain: Caip2;
  /** The vault (deposit target, or the share token being redeemed). */
  vault: string;
  token: string;
  amountAtomic: AtomicString;
  fromAddress: string;
}

/** A paid catalog run through PayBox `use_service` on `/v2/run/<id>`: one request per pay card version. */
export interface RunInput {
  toolId: string;
  input: unknown;
  /** The live 402's exact price, frozen on the pay card. */
  priceAtomic: AtomicString;
}

/** Paying a Hako invoice (`GET /v2/invoice/<id>`) through PayBox `use_service` (plan add-ons, J10). */
export interface InvoicePayInput {
  invoiceId: string;
}

export interface DraftInputs {
  send: SendInput;
  swap: RouteInput;
  bridge: RouteInput;
  earn_deposit: EarnInput;
  earn_withdraw: EarnInput;
  run: RunInput;
  invoice_pay: InvoicePayInput;
}
export type DraftKind = keyof DraftInputs;
export type DraftInput<K extends DraftKind = DraftKind> = DraftInputs[K];
/** An edit from the card (network, token, amount…): each one makes a new draft version. */
export type DraftPatch<K extends DraftKind = DraftKind> = Partial<DraftInputs[K]>;

/**
 * What a draft version was quoted at. @hako/defi's normalised LI.FI quote satisfies this shape (it carries more:
 * the route, fee breakdown, `transactionRequest`); sends, runs and invoice payments carry a price but no route.
 */
export interface DraftQuote {
  /** The LI.FI tool the route uses (null when no LI.FI route is involved). */
  tool: string | null;
  fromAmountAtomic: AtomicString;
  toAmountAtomic: AtomicString;
  /** R15: a fresh quote below this minimum goes back for review instead of becoming a proposal. */
  toAmountMinAtomic: AtomicString;
  /** All fees and gas, in USD as a decimal string, for the card's fee line. */
  feeUsd: string | null;
  estimatedDurationS: number | null;
  /** The spender an exact approve must name first (R16), or null when no approve is needed. */
  approvalAddress: string | null;
  quotedAt: IsoTime;
  expiresAt: IsoTime;
}

/**
 * The rehearsal line (plan B13 `/v1/rehearse`): `eth_simulateV1` on the source chain's public RPC, Solana
 * `simulateTransaction`. `skipped` = over the REHEARSAL_TIMEOUT_MS budget; `unsupported` = "Not rehearsed on <chain>".
 * A chain that can't simulate is never shown as a pass.
 */
export type RehearsalStatus = "passed" | "failed" | "skipped" | "unsupported";
export interface Rehearsal {
  status: RehearsalStatus;
  /** Cached by `id:version`: a rehearsal belongs to exactly one draft version. */
  key: `${string}:${number}`;
  chain: Caip2;
  /** Why it failed or was skipped, in words. */
  reason?: string;
  simulatedAt?: IsoTime;
}

/** A draft as a card shows it: the latest version, its quote and rehearsal, its intent state. */
export interface DraftView<K extends DraftKind = DraftKind> {
  id: string;
  kind: K;
  version: number;
  state: IntentState;
  input: DraftInput<K>;
  quote: DraftQuote | null;
  rehearsal: Rehearsal | null;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

/** `reviseDraft` → the new version, re-quoted and re-rehearsed in the same card. */
export interface DraftRevision {
  version: number;
  quote: DraftQuote | null;
  rehearsal: Rehearsal | null;
}

/** `executeDraft` → the one PayBox request for that version (a repeated execute returns the stored one). */
export interface ExecuteResult {
  draftId: string;
  version: number;
  requestId: string;
  status: PayboxRequestStatus;
  /** Present while the request waits at `pending_approval` ("Approve in PayBox"). */
  approvalUrl: string | null;
  /** True when this call found the request already created for this version and created nothing. */
  reused: boolean;
  phase: CardPhase;
}

/** `readStatus` → what the card shows now: re-read from the store and PayBox, never from the draft alone. */
export interface DraftStatus {
  draftId: string;
  version: number;
  state: IntentState;
  phase: CardPhase;
  requestId: string | null;
  requestStatus: PayboxRequestStatus | null;
  approvalUrl: string | null;
  /** Source and (for a bridge) destination transaction hashes once known. */
  txHashes: { source: string | null; destination: string | null };
  /** "Signed but not sent — no money moved", "Checking whether this went through"… */
  reason: string | null;
  updatedAt: IsoTime;
}

export interface MoneyIntents {
  createDraft<K extends DraftKind>(kind: K, input: DraftInput<K>): Promise<DraftView<K>>;
  reviseDraft<K extends DraftKind>(id: string, patch: DraftPatch<K>): Promise<DraftRevision>;
  /**
   * Inserts the unique `(draft_id, version)` row first, then creates the PayBox request once (`request_transfer`,
   * `request_wallet_sign` + the broadcast job, or `use_service`) and stores its `request_id`. An unknown outcome
   * (timeout, 5xx, dropped connection) is reconciled with `list_requests` before anything is created again.
   */
  executeDraft(id: string, version: number, userId: string): Promise<ExecuteResult>;
  readStatus(id: string): Promise<DraftStatus>;
}

/** Which PayBox core tool a draft kind's request is created with. */
export type PayboxRequestKind = "transfer" | "wallet_sign" | "use_service";

/** The `(draft_id, version)` execution row: unique, written before the PayBox request exists. */
export interface ExecutionRow {
  draftId: string;
  version: number;
  userId: string;
  requestKind: PayboxRequestKind;
  /** Null until PayBox answered; a row without one after a failed call is reconciled, never re-created blindly. */
  requestId: string | null;
  /** The PayBox client that minted the request (only that client can read it back). */
  clientId: string | null;
  createdAt: IsoTime;
}

/** Drafts, versions and execution rows (server: @hako/db; CLI: an in-process store). */
export interface DraftStore {
  insertDraft(draft: DraftView): Promise<void>;
  /** The latest version, or null for an unknown id. */
  getDraft(id: string): Promise<DraftView | null>;
  getVersion(id: string, version: number): Promise<DraftView | null>;
  /** Stores `next` as version `expectedVersion + 1`; false when another edit got there first. */
  appendVersion(id: string, expectedVersion: number, next: DraftView): Promise<boolean>;
  /** Moves the draft's state only when it is still `from` (and `canTransition(from, to)` holds); false otherwise. */
  setState(id: string, from: IntentState, to: IntentState): Promise<boolean>;
  /** Inserts the unique row, or returns the one already there with `created: false`. */
  claimExecution(row: Omit<ExecutionRow, "requestId" | "clientId" | "createdAt">): Promise<{ row: ExecutionRow; created: boolean }>;
  recordRequest(draftId: string, version: number, requestId: string, clientId: string): Promise<void>;
  getExecution(draftId: string, version: number): Promise<ExecutionRow | null>;
}

/** A PayBox request envelope as `request_*`, `use_service` and `get_request` return it. */
export interface PayboxRequest {
  requestId: string;
  status: PayboxRequestStatus;
  approvalUrl: string | null;
  /** The request's output on `success` (signed tx, tx hash, x402 response…), as PayBox returns it. */
  output: unknown;
  /** `denied` carries a reason, `error` a message. */
  reason: string | null;
  createdAt: IsoTime | null;
}

/** Hako-level arguments; each caller maps them to PayBox's live tool schema (SP5 records `request_transfer`'s). */
export interface TransferArgs {
  credentialId: string;
  chain: Caip2;
  token: string;
  to: string;
  amountAtomic: AtomicString;
}

/** `request_wallet_sign` with `op: transaction` (EVM, eip1559 fields set by `/v1/broadcast`) or `solanaTransaction`. */
export type WalletSignArgs =
  | {
      credentialId: string;
      op: "transaction";
      transaction: { chainId: number; to: string; value: AtomicString; data: string; gas: AtomicString; nonce: number; maxFeePerGas: AtomicString; maxPriorityFeePerGas: AtomicString };
    }
  | { credentialId: string; op: "solanaTransaction"; address: string; transactionBase64: string };

export interface UseServiceArgs {
  credentialId: string;
  url: string;
  method: "GET" | "POST";
  body?: unknown;
}

export interface ListRequestsFilter {
  status?: PayboxRequestStatus;
  limit?: number;
  /** Keyset cursor: the last row's `created_at` and `request_id`. */
  before?: IsoTime;
  beforeId?: string;
}

/** PayBox core tools as the money core needs them (server: `@ai-sdk/mcp` with the user's bearer; CLI: the SDK). */
export interface PayboxCaller {
  /** The PayBox client this caller's requests are minted under (stored on every execution row). */
  readonly clientId: string;
  requestTransfer(args: TransferArgs): Promise<PayboxRequest>;
  requestWalletSign(args: WalletSignArgs): Promise<PayboxRequest>;
  useService(args: UseServiceArgs): Promise<PayboxRequest>;
  getRequest(requestId: string): Promise<PayboxRequest>;
  /** Newest first; only this client's requests. */
  listRequests(filter: ListRequestsFilter): Promise<readonly PayboxRequest[]>;
}

/** Quotes and rehearsals for a draft version (server and CLI: the gateway's `/v1/quote` and `/v1/rehearse`). */
export interface DraftPricer {
  quote<K extends DraftKind>(kind: K, input: DraftInput<K>): Promise<DraftQuote | null>;
  rehearse(draft: DraftView): Promise<Rehearsal>;
}

export interface MoneyIntentDeps {
  store: DraftStore;
  /**
   * The PayBox caller for a Hako user (server: that user's per-user client and stored token; CLI: the local
   * PayboxClient, whatever the id). `readStatus` uses the user on the version's execution row.
   */
  payboxFor(userId: string): Promise<PayboxCaller>;
  pricer: DraftPricer;
}

/** W0.6 implements this signature. */
export type CreateMoneyIntents = (deps: MoneyIntentDeps) => MoneyIntents;
