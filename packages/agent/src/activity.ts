import {
  type ActivityData,
  type ActivityRow,
  type ActivitySurface,
  isTerminalRequestStatus,
  type PayboxRequestStatus,
  type ReceiptData,
  type ReceiptKind,
  type ReceiptStatus,
  requestStatusToPhase,
  requestWaitsOn,
  type RequestWait,
} from "@hako/cards/contract";
import type { Caip2 } from "@hako/networks";
import type { PayboxRequest } from "@hako/paybox";
import { z } from "zod";

import { ACTIVITY_LIVE_REFRESH_MAX } from "./agent.config.ts";
import type { AgentDeps, PayboxAccount } from "./deps.ts";
import { invalidInput, payboxNotConnected } from "./errors.ts";
import { isLimitDenial, PHASE_BY_RECEIPT, RAISE_LIMIT_FIX } from "./outcomes.ts";

/**
 * The activity ledger (plan §1 "Shared by all", add-ons "Activity ledger"): Hako's receipts (`GET /v1/receipts`, when
 * the caller holds a Hako session) merged with PayBox `list_requests` (requests that never produced a receipt: denied,
 * failed or still waiting, "Your agent stopped at your limit · Raise it"). Where there is no Hako session (`hako mcp`)
 * PayBox's list is the whole ledger. Live rows are re-read with `get_request`.
 */

export interface ActivityQuery {
  cursor?: string;
  limit: number;
  kind?: ReceiptKind;
  status?: ReceiptStatus;
  chain?: Caip2;
  surface?: ActivitySurface;
}

/** Where each source's next page starts; null once a source has nothing older. Opaque to the caller (base64url JSON). */
const cursorSchema = z.object({
  receipts: z.string().min(1).nullable(),
  requests: z.object({ before: z.string().min(1), beforeId: z.string().min(1) }).nullable(),
});
type ActivityCursor = z.output<typeof cursorSchema>;

const encodeCursor = (cursor: ActivityCursor): string =>
  btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function decodeCursor(text: string): ActivityCursor {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(atob(text.replaceAll("-", "+").replaceAll("_", "/"))));
    if (parsed.success) return parsed.data;
  } catch {
    // Falls through to the refusal below.
  }
  throw invalidInput("That cursor is not one hako_activity returned: leave it out for the newest rows.");
}

const WAIT_WORDS: Record<RequestWait, string> = {
  approval: "Waiting for your approval in PayBox",
  funding: "Waiting for funds",
  signature: "Waiting for PayBox to sign",
  settlement: "Arriving",
  confirmation: "Confirming on chain",
};
const END_WORDS: Record<"denied" | "error", string> = { denied: "Declined in PayBox", error: "Failed in PayBox" };

function receiptWords(receipt: ReceiptData): string {
  if (receipt.status === "pending") return "Pending";
  if (receipt.status === "reverted") return "Failed on chain";
  if (receipt.kind === "bridge") return "Arrived";
  return receipt.kind === "invoice" || receipt.kind === "run" || receipt.kind === "batch" ? "Paid" : "Confirmed";
}

function receiptRow(receipt: ReceiptData): ActivityRow {
  const amount = receipt.sent ?? receipt.received;
  const tx = receipt.txs[0] ?? null;
  return {
    id: receipt.id,
    kind: receipt.kind,
    verb: receipt.title,
    direction: receipt.sent ? "out" : receipt.received ? "in" : "none",
    amount,
    phase: PHASE_BY_RECEIPT[receipt.status],
    statusText: receiptWords(receipt),
    chain: tx?.chain ?? amount?.token.chain ?? null,
    tx,
    requestId: receipt.requestId,
    receiptId: receipt.id,
    surface: receipt.surface,
    fix: null,
    at: receipt.at,
  };
}

/** A row as its PayBox request stands: waiting, stopped at the limit, declined or failed. A success leaves it as it is. */
function withRequestStatus(row: ActivityRow, status: PayboxRequestStatus, reason: string | null): ActivityRow {
  const wait = requestWaitsOn(status);
  if (wait) return { ...row, phase: "live", statusText: WAIT_WORDS[wait] };
  if (isLimitDenial(status, reason)) return { ...row, phase: "denied", statusText: "Your agent stopped at your limit", fix: RAISE_LIMIT_FIX };
  if (status === "denied" || status === "error") return { ...row, phase: requestStatusToPhase(status), statusText: END_WORDS[status] };
  return row;
}

/** A PayBox request with no receipt. `list_requests` names no kind, amount or chain, so the row says only what it knows. */
function requestRow(request: PayboxRequest): ActivityRow | null {
  if (!request.createdAt) return null;
  const row: ActivityRow = {
    id: request.requestId,
    kind: null,
    verb: "PayBox request",
    direction: "none",
    amount: null,
    phase: "result",
    statusText: "Done",
    chain: null,
    tx: null,
    requestId: request.requestId,
    receiptId: null,
    surface: null,
    fix: null,
    at: request.createdAt,
  };
  return withRequestStatus(row, request.status, request.reason);
}

/** Which PayBox requests a filter keeps: they carry no kind, chain or surface, and only a status. */
const REQUEST_STATUS_MATCHES: Record<ReceiptStatus, (status: PayboxRequestStatus) => boolean> = {
  pending: (status) => !isTerminalRequestStatus(status),
  confirmed: (status) => status === "success",
  reverted: () => false,
};

function keepsRequests(query: ActivityQuery): boolean {
  return !query.kind && !query.chain && !query.surface && query.status !== "reverted";
}

/** Pending rows re-read from PayBox (`list_requests` and stored receipts may lag), a page's first few at most. */
async function refreshLive(account: PayboxAccount | null, rows: ActivityRow[]): Promise<ActivityRow[]> {
  if (!account) return rows;
  const pending = rows.filter((row) => row.phase === "live" && row.requestId).slice(0, ACTIVITY_LIVE_REFRESH_MAX);
  const live = new Map(await Promise.all(pending.map(async (row) => [row.id, await account.getRequest(row.requestId as string)] as const)));
  return rows.map((row) => {
    const request = live.get(row.id);
    return request ? withRequestStatus(row, request.status, request.reason) : row;
  });
}

export async function activityPage(deps: AgentDeps, query: ActivityQuery): Promise<ActivityData> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const account = deps.account;
  const withReceipts = await deps.gateway.authenticated();
  if (!withReceipts && !account) throw payboxNotConnected();

  const readReceipts = withReceipts && (cursor === null || cursor.receipts !== null);
  const { kind, status, chain, surface, limit } = query;
  const filters = { ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(chain ? { chain } : {}), ...(surface ? { surface } : {}) };
  const page = readReceipts ? await deps.gateway.call("receipts", { query: { limit, ...filters, ...(cursor?.receipts ? { cursor: cursor.receipts } : {}) } }) : null;

  const readRequests = account !== null && keepsRequests(query) && (cursor === null || cursor.requests !== null);
  const before = cursor?.requests ? { before: cursor.requests.before, beforeId: cursor.requests.beforeId } : {};
  const requests = readRequests ? await account.listRequests({ limit, ...before }) : [];

  const receiptRows = page?.receipts.map(receiptRow) ?? [];
  const recorded = new Set(receiptRows.flatMap((row) => (row.requestId ? [row.requestId] : [])));
  const requestRows = requests
    // With receipts, a successful request is its receipt's row; without them it is the only record there is.
    .filter((request) => !(withReceipts && request.status === "success") && !recorded.has(request.requestId))
    .filter((request) => (status ? REQUEST_STATUS_MATCHES[status](request.status) : true))
    .flatMap((request) => requestRow(request) ?? []);
  const rows = [...receiptRows, ...requestRows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const last = requests.at(-1);
  const next: ActivityCursor = {
    receipts: page?.nextCursor ?? null,
    requests: readRequests && requests.length >= limit && last?.createdAt ? { before: last.createdAt, beforeId: last.requestId } : null,
  };
  return { rows: await refreshLive(account, rows), nextCursor: next.receipts || next.requests ? encodeCursor(next) : null };
}
