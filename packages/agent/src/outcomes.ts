import {
  anyRunEnvelopeSchema,
  CARD_SCHEMAS,
  type CardData,
  type CardPhase,
  type DraftKindName,
  type FailureData,
  type IntentState,
  invoiceDataSchema,
  isCatalogRenderKind,
  type MoneyMoved,
  type NamedFix,
  type OutcomeCardKind,
  type PaymentLine,
  type PayboxRequestStatus,
  payboxServiceOutputSchema,
  type ReceiptData,
  type ReceiptKind,
  type StructuredContent,
  type Suggestion,
  type TxLink,
} from "@hako/cards/contract";
import { fromAtomic } from "@hako/money";
import { X402_NETWORK } from "@hako/networks";
import type { DraftStatus, DraftView } from "@hako/paybox";

import { FAILURE_TECHNICAL_MAX_CHARS, HTTP_OK_END, HTTP_OK_MIN, LIMIT_DENIAL_PATTERN } from "./agent.config.ts";
import { card, chip } from "./define.ts";
import type { AgentDeps } from "./deps.ts";
import { sourceOf } from "./resolve.ts";
import { requestRef, statusCard, txLinks } from "./status-cards.ts";

/**
 * What a draft version turns into once it runs (plan §1 card flow steps 1, 3 and 4): a paid run becomes its result card
 * with the receipt line, a paid invoice the Paid invoice, a move its receipt once it confirms or reverts, anything
 * refused or failed a failure card that says whether money moved, and everything in between the live status card.
 * `hako_execute`, `hako_request_status`, `hako_broadcast` and `hako_refresh` all answer through here.
 */

export type OutcomeCard = StructuredContent<OutcomeCardKind>;

/** Where a draft version's run stands now: from `executeDraft`, `readStatus` or the broadcast route. */
export interface RunState {
  /** The draft version that ran. */
  version: number;
  phase: CardPhase;
  /** The intent state of that version; null when the store has moved past it. */
  state: IntentState | null;
  requestId: string | null;
  requestStatus: PayboxRequestStatus | null;
  approvalUrl: string | null;
  txs: TxLink[];
  reason: string | null;
  reused: boolean;
}

/** A draft's stored status (`readStatus`) as a run state. */
export const runOfStatus = (view: DraftView, status: DraftStatus): RunState => ({
  version: status.version,
  phase: status.phase,
  state: status.state,
  requestId: status.requestId,
  requestStatus: status.requestStatus,
  approvalUrl: status.approvalUrl,
  txs: txLinks(view, status.txHashes),
  reason: status.reason,
  reused: false,
});

export const PHASE_BY_RECEIPT: Record<ReceiptData["status"], CardPhase> = { confirmed: "result", reverted: "error", pending: "live" };

/** The card flow's next steps after a move (plan §1 step 5): check balance, earn on it, show activity. */
export function receiptNextSteps(receipt: ReceiptData): Suggestion[] {
  if (receipt.status !== "confirmed" || receipt.kind === "run" || receipt.kind === "batch") return [];
  const symbol = receipt.received?.token.symbol ?? receipt.sent?.token.symbol ?? "it";
  return [
    chip("Check balance", "What's in my PayBox wallet now?"),
    chip("Earn on it", `Where can my ${symbol} earn the most?`),
    chip("Show activity", "Show my recent Hako activity"),
  ];
}

export const receiptCard = (deps: AgentDeps, receipt: ReceiptData): StructuredContent<"receipt"> =>
  card("receipt", receipt, { phase: PHASE_BY_RECEIPT[receipt.status], suggestions: receiptNextSteps(receipt) }, deps);

/** The receipt kind each draft kind is recorded as. */
const RECEIPT_KIND: Record<DraftKindName, ReceiptKind> = {
  send: "send",
  swap: "swap",
  bridge: "bridge",
  earn_deposit: "earn_deposit",
  earn_withdraw: "earn_withdraw",
  run: "run",
  invoice_pay: "invoice",
};

/** What the person calls each draft kind on a failure card. */
const VERB: Record<DraftKindName, string> = {
  send: "send",
  swap: "swap",
  bridge: "bridge",
  earn_deposit: "deposit",
  earn_withdraw: "withdrawal",
  run: "payment",
  invoice_pay: "invoice payment",
};

/**
 * The draft's own receipt (`GET /v1/receipts?draftId=`), when the caller holds a Hako session; `hako mcp` has none and
 * follows the status card instead. Approve receipts (R16's step 1) are a different kind and never match.
 */
export async function receiptOf(deps: AgentDeps, view: DraftView): Promise<ReceiptData | null> {
  if (!(await deps.gateway.authenticated())) return null;
  const page = await deps.gateway.call("receipts", { query: { draftId: view.id, kind: RECEIPT_KIND[view.kind], limit: 1 } });
  return page.receipts[0] ?? null;
}

/** Whether money left the wallet, for a request that ended without success (plan §1 step 4). */
export function moneyMovedOf(kind: DraftKindName, run: RunState): MoneyMoved {
  if (run.state === "unknown_outcome") return "unknown";
  if (run.requestStatus === "denied") return "no";
  // A transaction exists, or PayBox sends this kind itself (a transfer may fail after it was broadcast): the chain decides.
  if (run.txs.length > 0 || kind === "send") return "unknown";
  // A wallet sign is never broadcast by PayBox, and an x402 payment settles only when the paid call succeeds.
  return "no";
}

const MONEY_WORDS: Record<MoneyMoved, string> = {
  no: "No money moved.",
  yes: "Money moved: check the transaction below.",
  unknown: "Checking whether this went through.",
};

/** The way forward after a failure: a fresh quote for a move, the same call again for a payment. */
function retryFix(view: DraftView): NamedFix {
  if (view.kind === "run") {
    const toolId = (view as DraftView<"run">).input.toolId;
    return { fix: "retry", action: { type: "prompt", label: "Run it again", prompt: `Run ${toolId} again with the same input` } };
  }
  if (view.kind === "invoice_pay") {
    const invoiceId = (view as DraftView<"invoice_pay">).input.invoiceId;
    return { fix: "retry", action: { type: "prompt", label: "Pay it again", prompt: `Pay invoice ${invoiceId} again` } };
  }
  return { fix: "fresh_quote", action: { type: "prompt", label: "Get a fresh quote", prompt: `Get me a fresh quote for the same ${VERB[view.kind]}` } };
}

/** "Your agent stopped at your limit · Raise it": PayBox's limit page, through hako_limit. */
export const RAISE_LIMIT_FIX: NamedFix = { fix: "raise_limit", action: { type: "tool", label: "Raise it", tool: "hako_limit", input: {} } };

export const isLimitDenial = (status: PayboxRequestStatus | null, reason: string | null): boolean =>
  status === "denied" && reason !== null && LIMIT_DENIAL_PATTERN.test(reason);

export interface FailureParts {
  title?: string;
  reason?: string | null;
  moneyMoved: MoneyMoved;
  technical?: string | null;
  fix?: NamedFix | null;
}

export function failureCard(deps: AgentDeps, view: DraftView, run: RunState, parts: FailureParts): StructuredContent<"failure"> {
  const denied = run.requestStatus === "denied" || run.state === "rejected";
  const limit = isLimitDenial(run.requestStatus, run.reason);
  const verb = VERB[view.kind];
  const title = parts.title ?? (limit ? "Your agent stopped at your limit" : denied ? `The ${verb} was declined in PayBox` : `The ${verb} didn't go through`);
  const data: FailureData = {
    title,
    reason: parts.reason ?? run.reason ?? MONEY_WORDS[parts.moneyMoved],
    moneyMoved: parts.moneyMoved,
    requestId: run.requestId,
    txs: run.txs,
    fix: parts.fix !== undefined ? parts.fix : limit ? RAISE_LIMIT_FIX : denied ? null : retryFix(view),
    technical: parts.technical ?? null,
  };
  const request = run.requestId && run.requestStatus ? requestRef(deps, run.requestId, run.requestStatus, run.approvalUrl) : null;
  const intent = run.state ? { id: view.id, version: run.version, state: run.state } : undefined;
  return card("failure", data, { phase: denied ? "denied" : "error", ...(intent ? { intent } : {}), ...(request ? { request } : {}) }, deps);
}

/** The paid route's answer PayBox stored on the request, parsed when it was sent as JSON text. */
function paidResponse(output: unknown): { status: number; body: unknown } | null {
  const parsed = payboxServiceOutputSchema.safeParse(output);
  if (!parsed.success) return null;
  const { status, body } = parsed.data.value.response;
  if (typeof body !== "string") return { status, body };
  try {
    return { status, body: JSON.parse(body) as unknown };
  } catch {
    return { status, body };
  }
}

/**
 * A paid run's result card or a paid invoice, with its receipt line: the amount frozen on the draft version, the
 * settlement tx when a receipt records it, and the PayBox request id. Null when PayBox stored no readable answer (the
 * status card then says the payment is done).
 */
async function paidCard(deps: AgentDeps, view: DraftView, run: RunState, requestId: string): Promise<OutcomeCard | null> {
  if (!deps.account) return null;
  const response = paidResponse((await deps.account.getRequest(requestId)).output);
  if (!response) return null;
  if (response.status < HTTP_OK_MIN || response.status >= HTTP_OK_END) {
    const technical = `HTTP ${response.status}: ${JSON.stringify(response.body) ?? ""}`.slice(0, FAILURE_TECHNICAL_MAX_CHARS);
    // The gateway settles an x402 payment only on success, so an error answer was never paid for.
    return failureCard(deps, view, run, { title: "The paid call didn't answer", moneyMoved: "no", reason: "Nothing was charged.", technical });
  }
  const receipt = await receiptOf(deps, view);
  const intent = run.state ? { intent: { id: view.id, version: run.version, state: run.state } } : {};
  const request = run.requestStatus ? { request: requestRef(deps, requestId, run.requestStatus, run.approvalUrl) } : {};
  const tx = receipt?.txs[0] ?? null;
  if (view.kind === "invoice_pay") {
    const invoice = invoiceDataSchema.safeParse(response.body);
    if (!invoice.success) return null;
    const payment: PaymentLine = { amount: invoice.data.amount, tx: invoice.data.tx ?? tx, requestId };
    return card("invoice", invoice.data, { phase: invoice.data.status === "paid" ? "result" : "live", ...intent, ...request, payment }, deps);
  }
  const envelope = anyRunEnvelopeSchema.safeParse(response.body);
  if (!envelope.success) return null;
  const { usdc } = X402_NETWORK;
  const priceAtomic = (view as DraftView<"run">).input.priceAtomic;
  const payment: PaymentLine = {
    // x402 prices are USD amounts paid in USDC, so the USD value is the amount itself.
    amount: { token: { chain: X402_NETWORK.caip2, address: usdc.address, symbol: usdc.symbol, decimals: usdc.decimals, name: usdc.name }, amountAtomic: priceAtomic, usd: fromAtomic(BigInt(priceAtomic), usdc.decimals) },
    tx,
    requestId,
  };
  const render = envelope.data.render;
  const kind = isCatalogRenderKind(render) && CARD_SCHEMAS[render].safeParse(envelope.data.data).success ? render : "json";
  const data = CARD_SCHEMAS[kind].parse(envelope.data.data) as CardData<typeof kind>;
  return card(kind, data, { phase: "result", ...intent, ...request, source: sourceOf(envelope.data), payment }, deps);
}

/** The card a draft version's run shows now. */
export async function outcomeCard(deps: AgentDeps, view: DraftView, run: RunState): Promise<OutcomeCard> {
  const ended = run.requestStatus === "denied" || run.requestStatus === "error" || run.state === "failed" || run.state === "rejected";
  if (ended) return failureCard(deps, view, run, { moneyMoved: moneyMovedOf(view.kind, run) });
  const succeeded = run.requestStatus === "success" || run.state === "completed";
  if (succeeded && run.requestId && (view.kind === "run" || view.kind === "invoice_pay")) {
    const paid = await paidCard(deps, view, run, run.requestId);
    if (paid) return paid;
  }
  // A move whose request finished: its receipt once it confirms or reverts; until then the status card names it.
  const receipt = succeeded ? await receiptOf(deps, view) : null;
  if (receipt && receipt.status !== "pending") return receiptCard(deps, receipt);
  return statusCard(deps, {
    phase: run.phase,
    draftId: view.id,
    version: run.version,
    kind: view.kind,
    state: run.state,
    requestId: run.requestId,
    requestStatus: run.requestStatus,
    approvalUrl: run.approvalUrl,
    txs: run.txs.length > 0 ? run.txs : (receipt?.txs ?? []),
    reason: run.reason,
    reused: run.reused,
    receiptId: receipt?.id ?? null,
  });
}
