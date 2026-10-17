import type { GatewayClient } from "@hako/cards/client";
import type { ApprovalModeName, Contact, TokenAmount } from "@hako/cards/contract";
import type { Caip2, NetworkFamily } from "@hako/networks";
import type { DraftView, MoneyIntents, PayboxCaller } from "@hako/paybox";

/**
 * What every tool's `execute(input, deps)` is given (plan §5b: one registry, one store, one money core). The caller
 * builds it per request, already scoped to the caller: the web route handlers and voice from the session, the hosted
 * MCP server from the Hako JWT (or its anonymous session), `hako mcp` from the local PayBox config. Tools call only
 * these; none of them reaches for a global, a key or an environment variable.
 *
 * Scope: drafts and intents belong to whoever made them, a signed-in Hako user or an anonymous session. `intents`
 * creates drafts owned by this caller, and `drafts` returns only drafts this caller may see (its own, plus the drafts
 * its anonymous session made before it signed in). The tools also refuse an anonymous caller on a draft a signed-in
 * user owns.
 */
export interface AgentDeps {
  /** The signed-in Hako user, or null for an anonymous caller (free tools and drafts only). */
  user: AgentUser | null;
  /** The typed gateway client (`createGatewayClient`), carrying the user's Hako session as a bearer when there is one. */
  gateway: GatewayClient;
  /**
   * The gateway's public origin, where PayBox's servers fetch paid URLs (`/v2/run/*` on a pay card and in
   * `use_service` instructions). HAKO_GATEWAY_URL when absent; set it when `gateway` reaches an internal address.
   */
  publicGatewayUrl?: string;
  /** The money core (@hako/paybox, W0.6), scoped to the caller: drafts, versions, one PayBox request per version, status. */
  intents: MoneyIntents;
  /** Reads the latest version of the caller's drafts, so an edited or re-mounted card is drawn from the store, never from the client. */
  drafts: DraftReader;
  /** The user's PayBox, through their own per-user client; null until PayBox is connected. */
  account: PayboxAccount | null;
  /** The user's saved recipients (@hako/db); null for an anonymous caller. */
  contacts: ContactBook | null;
  /** Hako's web origin, for `/sign/<id>` and `/pay/<id>` links (HAKO_APP_URL in production). */
  appUrl: string;
  /** The clock cards are stamped with (`envelope.updatedAt`). */
  now: () => Date;
}

export interface AgentUser {
  /** The Better Auth user id: Hako's account key (SP10). */
  id: string;
}

/** A draft as the caller may see it: the latest version and who owns it. */
export interface OwnedDraft {
  view: DraftView;
  /** The Hako user who made it, or null for a draft made by an anonymous session. */
  ownerUserId: string | null;
}

/** The caller's drafts (server: @hako/db; CLI: its in-process store). */
export interface DraftReader {
  /** The latest version; null for an unknown id or a draft outside the caller's scope (as if it did not exist). */
  getDraft(id: string): Promise<OwnedDraft | null>;
}

/** A wallet the user granted to Hako's PayBox client (PayBox `list_credentials`, wallets only). */
export interface PayboxWallet {
  credentialId: string;
  name: string;
  family: NetworkFamily;
  /** One address on every EVM chain for an EVM wallet; a base58 address for Solana. */
  address: string;
  approvalMode: ApprovalModeName;
}

export interface PayboxCredentials {
  wallets: readonly PayboxWallet[];
  /** PayBox reports ungranted credentials as counts only. */
  ungranted: readonly { kind: "card" | "wallet" | "secret"; family: NetworkFamily | null; count: number }[];
  /** A paired signer key exists for this client (the CLI's `pbxk1.` key). */
  agentSignerRecorded: boolean;
}

/** `check_operation_readiness` (SP12): whether PayBox would let this operation start now, and what blocks it. */
export interface Readiness {
  canAttempt: boolean;
  blockers: readonly { code: string; message: string; nextAction: string }[];
  unknowns: readonly string[];
}

export interface PayboxPlugin {
  id: string;
  name: string | null;
  type: "official" | "unofficial";
  enabled: boolean;
}

/**
 * PayBox core reads and links for the signed-in user, normalised to Hako's shapes. The server implements it in
 * @hako/paybox over `@ai-sdk/mcp` with the user's per-user client (SP13); the CLI over its local PayboxClient. Nothing
 * here moves money: moves go through `MoneyIntents.executeDraft`.
 */
export interface PayboxAccount {
  /** `list_credentials`. */
  credentials(): Promise<PayboxCredentials>;
  /** `get_portfolio` for one address; `totalUsd` is null when any held token is unpriced (never a made-up $0). */
  portfolio(address: string): Promise<{ holdings: readonly TokenAmount[]; totalUsd: string | null }>;
  /** `check_operation_readiness` with the full operation object PayBox expects (SP12). */
  readiness(operation: Record<string, unknown>): Promise<Readiness>;
  /** `discover_plugins {status: 'enabled'}`. */
  enabledPlugins(): Promise<readonly PayboxPlugin[]>;
  /** `get_buy_link`: MoonPay's on-ramp for a granted wallet. */
  buyLink(args: { credentialId: string; chain?: Caip2; amountUsd?: number }): Promise<{ url: string; currencyCode: string; walletAddress: string; chain: Caip2 }>;
  /** `get_deposit_link`: PayBox's deposit page for a granted wallet. */
  depositLink(args: { credentialId: string; amountUsd?: number }): Promise<{ url: string; expiresAt: string; amountUsd: number | null }>;
  /** `request_account_change` → `manage_url`, where the person raises a limit or grants a wallet themselves. */
  accountChange(note?: string): Promise<{ manageUrl: string; note: string | null }>;
  /** `resolve_username`: a PayBox username's wallet addresses, or null when nobody has it. */
  resolveUsername(username: string): Promise<{ username: string; evm: string | null; solana: string | null } | null>;
  /** `get_request`: a request this client minted (its `output` is the paid response on a `use_service` success). */
  getRequest: PayboxCaller["getRequest"];
  /**
   * `list_requests`: this client's requests, newest first, with redacted outputs; `pending_*` rows may lag, so a live
   * row is re-read with `getRequest`. The activity ledger's source next to Hako's receipts (denied, failed and waiting
   * requests never produce a receipt), and its only source where the caller holds no Hako session (`hako mcp`).
   */
  listRequests: PayboxCaller["listRequests"];
}

export type NewContact = Omit<Contact, "id" | "createdAt">;

/** The user's saved recipients (@hako/db `contacts`), bound to the signed-in user. */
export interface ContactBook {
  list(): Promise<readonly Contact[]>;
  /** By saved name (case-insensitive) or PayBox username; null when none matches. */
  find(nameOrUsername: string): Promise<Contact | null>;
  add(contact: NewContact): Promise<Contact>;
  rename(id: string, name: string): Promise<Contact>;
  remove(id: string): Promise<void>;
  /** Marks a contact verified (plan D25): `hako_contacts` calls it only after the scanned QR matched its address. */
  verify(id: string): Promise<Contact>;
}
