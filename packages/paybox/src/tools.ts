/**
 * Typed wrappers over PayBox core MCP tools (plan §1 "Shared by all", §3 PayBox row). Inputs are Hako's camelCase,
 * mapped to the live `tools/list` schemas (captured 2026-10-17); outputs keep PayBox's own field names where
 * @paybox-sh/sdk 2.2.0 types them, and request envelopes are read into `PayboxRequestEnvelope`.
 */
import { createHash } from "node:crypto";

import type { CallToolResult } from "@ai-sdk/mcp";

import type { ListRequestsFilter, TransferArgs, UseServiceArgs, WalletSignArgs } from "./intents/types.ts";
import { toolPayload, type PayboxMcpSession, type ToolCallOptions } from "./mcp.ts";
import { HEX_RADIX, UUID_HEX_GROUPS, UUID_NAME_BASED_VERSION, UUID_VARIANT_BITS, UUID_VARIANT_MASK } from "./paybox.config.ts";
import { PayboxEnvelopeError, parseRequestEnvelope, type PayboxRequestEnvelope } from "./status.ts";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
/** Drops undefined fields so PayBox applies its own defaults. */
const args = (fields: Record<string, unknown>): Json => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

export type CredentialKind = "wallet" | "card" | "secret";
/** `always_approve` = passkey in the PayBox app; `iframe` = confirm in the signing window; `autonomous`; `paybox`. */
export type ApprovalMode = "always_approve" | "iframe" | "autonomous" | "paybox";

export interface PayboxCredential {
  credentialId: string;
  name: string;
  kind: CredentialKind;
  approvalMode: ApprovalMode | null;
  /** A wallet's address (one address on every EVM chain), null for older wallets and other kinds. */
  address: string | null;
  /** A wallet's family: `["evm"]` or `["solana"]`. */
  chains: string[];
  metadata: Json;
}

export interface PayboxCredentialList {
  credentials: PayboxCredential[];
  /** Credentials the user owns but hasn't granted this client (grant them with `requestAccountChange({add})`). */
  ungranted: Omit<PayboxCredential, "approvalMode">[];
  /** False: this client has no recorded signer; the first `pending_signature` asks the user to connect a key. */
  agentSignerRecorded: boolean;
}

function credential(value: unknown): PayboxCredential {
  const item = record(value);
  const metadata = record(item.metadata);
  return {
    credentialId: str(item.credential_id) ?? "",
    name: str(item.name) ?? "",
    kind: (str(item.kind) ?? "wallet") as CredentialKind,
    approvalMode: str(item.approval_mode) as ApprovalMode | null,
    address: str(metadata.address),
    chains: Array.isArray(metadata.chains) ? metadata.chains.filter((chain): chain is string => typeof chain === "string") : [],
    metadata,
  };
}

/** `get_portfolio`: PayBox's holdings view, kept as PayBox returns it (balances, USD, `total_usd`, `wallets`, `as_of`). */
export type PayboxPortfolio = Json & { total_usd?: number | null; address?: string | null; wallet_name?: string | null };

export interface BuyLinkResult {
  url: string;
  currency_code: string;
  wallet_address: string;
  network: string;
}
export interface DepositLinkResult {
  kind: "deposit_link";
  intent_id: string;
  credential_id: string;
  amount_usd: number | null;
  deposit_url: string;
  expires_at: string;
  message: string;
}
export interface OperationReadiness {
  client_id: string;
  environment: string;
  operation: string;
  can_attempt: boolean;
  blockers: { code: string; message: string; next_action: string }[];
  unknowns: string[];
}
export interface ResolvedUsername {
  found: boolean;
  /** At most one per family; an `evm` address receives on every EVM chain. */
  addresses: { family: "evm" | "solana"; address: string }[];
}
export interface AccountChangeResult {
  kind: "account_change";
  client_id: string;
  /** Changes nothing by itself: the user confirms in their own PayBox session. */
  manage_url: string;
  note?: string | null;
}
export interface PluginSummary {
  id: string;
  name?: string;
  description?: string;
  type: "official" | "unofficial";
  enabled: boolean;
  contract_uri?: string;
  enable_url?: string;
  /** Unofficial plugins carry their persisted tool definitions here. */
  tools?: { name: string; title?: string; description?: string; inputSchema: Json; outputSchema?: Json | null }[];
}
export interface DiscoverPluginsPage {
  plugins: PluginSummary[];
  has_more: boolean;
  next_cursor?: string | null;
}
export interface PluginInvocation {
  /** The plugin's own tool result, as PayBox returns it. */
  result: CallToolResult;
  /** The PayBox request the plugin's proposal became (money tools), or null for a read-only tool. */
  request: PayboxRequestEnvelope | null;
}

/**
 * `use_plugin`'s `invocation_id` for one draft version (plan §1: a UUID derived from `draft_id:version`), so a retry
 * of the same version retrieves the stored outcome instead of running the plugin twice.
 */
export function invocationIdFor(draftId: string, version: number): string {
  const hex = createHash("sha256").update(`hako:${draftId}:${version}`).digest("hex");
  const groups: string[] = [];
  let at = 0;
  for (const size of UUID_HEX_GROUPS) {
    groups.push(hex.slice(at, at + size));
    at += size;
  }
  const [timeLow = "", timeMid = "", timeHigh = "", clock = "", node = ""] = groups;
  // RFC 9562 layout: the version nibble says "name-based", the variant bits are 10xx.
  const variant = ((parseInt(clock.charAt(0), HEX_RADIX) & UUID_VARIANT_MASK) | UUID_VARIANT_BITS).toString(HEX_RADIX);
  return [timeLow, timeMid, `${UUID_NAME_BASED_VERSION}${timeHigh.slice(1)}`, `${variant}${clock.slice(1)}`, node].join("-");
}

function rows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const body = record(payload);
  for (const key of ["requests", "rows", "items", "data"]) if (Array.isArray(body[key])) return body[key] as unknown[];
  throw new PayboxEnvelopeError("PayBox's list_requests answer has no rows.");
}

export function createPayboxTools(session: PayboxMcpSession) {
  const call = (tool: string, input: Json, options?: ToolCallOptions) => session.call(tool, input, options);
  const envelope = async (tool: string, input: Json, options?: ToolCallOptions) => parseRequestEnvelope(await call(tool, input, options));

  return {
    async listCredentials(options?: ToolCallOptions): Promise<PayboxCredentialList> {
      const body = record(await call("list_credentials", {}, options));
      return {
        credentials: (Array.isArray(body.credentials) ? body.credentials : []).map(credential),
        ungranted: (Array.isArray(body.ungranted) ? body.ungranted : []).map(credential),
        agentSignerRecorded: body.agent_signer_recorded === true,
      };
    },
    async getPortfolio(input: { address?: string; networkIds?: string; token?: string; networkId?: number } = {}, options?: ToolCallOptions): Promise<PayboxPortfolio> {
      return record(await call("get_portfolio", args({ address: input.address, network_ids: input.networkIds, token: input.token, network_id: input.networkId }), options));
    },
    async getBuyLink(input: { credentialId: string; destinationChain?: string; currencyCode?: string; amountUsd?: number }, options?: ToolCallOptions): Promise<BuyLinkResult> {
      const body = { credential_id: input.credentialId, destination_chain: input.destinationChain, currency_code: input.currencyCode, amount_usd: input.amountUsd };
      return (await call("get_buy_link", args(body), options)) as BuyLinkResult;
    },
    async getDepositLink(input: { credentialId: string; amountUsd?: number }, options?: ToolCallOptions): Promise<DepositLinkResult> {
      return (await call("get_deposit_link", args({ credential_id: input.credentialId, amount_usd: input.amountUsd }), options)) as DepositLinkResult;
    },
    /** Pass the exact operation object the operation tool would receive (SP12: `{type, credential_id, …}`). */
    async checkOperationReadiness(operation: Json, options?: ToolCallOptions): Promise<OperationReadiness> {
      return (await call("check_operation_readiness", { operation }, options)) as OperationReadiness;
    },
    async resolveUsername(username: string, options?: ToolCallOptions): Promise<ResolvedUsername> {
      const body = record(await call("resolve_username", { username }, options));
      return { found: body.found === true, addresses: Array.isArray(body.addresses) ? (body.addresses as ResolvedUsername["addresses"]) : [] };
    },
    async requestAccountChange(
      input: { add?: string[]; remove?: string[]; create?: { kind: string; chain?: string; name?: string }[]; setMode?: { credentialId: string; mode: ApprovalMode }[]; note?: string },
      options?: ToolCallOptions,
    ): Promise<AccountChangeResult> {
      const setMode = input.setMode?.map((change) => ({ credential_id: change.credentialId, mode: change.mode }));
      return (await call("request_account_change", args({ add: input.add, remove: input.remove, create: input.create, set_mode: setMode, note: input.note }), options)) as AccountChangeResult;
    },
    async discoverPlugins(
      input: { query?: string; source?: "all" | "official" | "user"; status?: "all" | "enabled" | "disabled"; limit?: number; cursor?: string } = {},
      options?: ToolCallOptions,
    ): Promise<DiscoverPluginsPage> {
      const body = record(await call("discover_plugins", args(input), options));
      return { plugins: (Array.isArray(body.plugins) ? body.plugins : []) as PluginSummary[], has_more: body.has_more === true, next_cursor: str(body.next_cursor) };
    },
    /** `use_plugin`; `walletId` is the granted wallet the user chose (required when several fit). */
    async usePlugin(input: { pluginId: string; toolId: string; input: Json; invocationId?: string; walletId?: string }, options?: ToolCallOptions): Promise<PluginInvocation> {
      const body = args({ plugin_id: input.pluginId, tool_id: input.toolId, input: input.input, invocation_id: input.invocationId, wallet_id: input.walletId });
      const result = await session.callRaw("use_plugin", body, options);
      let request: PayboxRequestEnvelope | null;
      try {
        request = parseRequestEnvelope(toolPayload(result));
      } catch {
        request = null;
      }
      return { result, request };
    },
    /** `use_service` (gateway mode): PayBox probes the 402, the user approves and signs, PayBox re-fetches with payment. */
    useService(input: UseServiceArgs & { headers?: Record<string, string> }, options?: ToolCallOptions): Promise<PayboxRequestEnvelope> {
      return envelope("use_service", args({ credential_id: input.credentialId, url: input.url, method: input.method, body: input.body, headers: input.headers }), options);
    },
    /** `use_service` with `mode: "probe"`: one unpaid request, no payment request, PayBox's view of the 402. */
    async probeService(input: Omit<UseServiceArgs, "method"> & { method?: UseServiceArgs["method"] }, options?: ToolCallOptions): Promise<Json> {
      return record(await call("use_service", args({ credential_id: input.credentialId, url: input.url, method: input.method, body: input.body, mode: "probe" }), options));
    },
    requestWalletSign(input: WalletSignArgs, options?: ToolCallOptions): Promise<PayboxRequestEnvelope> {
      const intent =
        input.op === "transaction"
          ? { op: "transaction", transaction: input.transaction }
          : { op: "solanaTransaction", address: input.address, transactionBase64: input.transactionBase64 };
      return envelope("request_wallet_sign", { credential_id: input.credentialId, intent }, options);
    },
    /** `request_transfer`: PayBox builds and broadcasts it; omit `token` for the native coin. */
    requestTransfer(input: Omit<TransferArgs, "token"> & { token: string | null; valueCents?: number }, options?: ToolCallOptions): Promise<PayboxRequestEnvelope> {
      const body = { credential_id: input.credentialId, chain: input.chain, to: input.to, amount: input.amountAtomic, token: input.token ?? undefined, value_cents: input.valueCents };
      return envelope("request_transfer", args(body), options);
    },
    getRequest(requestId: string, options?: ToolCallOptions): Promise<PayboxRequestEnvelope> {
      return envelope("get_request", { request_id: requestId }, options);
    },
    /** This client's own requests, newest first (pending rows can be stale; outputs are redacted). */
    async listRequests(filter: ListRequestsFilter = {}, options?: ToolCallOptions): Promise<PayboxRequestEnvelope[]> {
      const payload = await call("list_requests", args({ status: filter.status, limit: filter.limit, before: filter.before, before_id: filter.beforeId }), options);
      return rows(payload).map(parseRequestEnvelope);
    },
  };
}

export type PayboxTools = ReturnType<typeof createPayboxTools>;
