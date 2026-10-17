import {
  type CardPhase,
  type DraftKindName,
  type IntentState,
  type MoveStage,
  type PayboxRequestStatus,
  pendingRequestStage,
  type RequestRef,
  requestWaitsOn,
  type StatusData,
  type StructuredContent,
  type TxLink,
} from "@hako/cards/contract";
import { HAKO_APP_PATHS } from "@hako/config";
import { type Caip2, X402_NETWORK } from "@hako/networks";
import type { DraftView } from "@hako/paybox";

import { card } from "./define.ts";
import type { AgentDeps } from "./deps.ts";
import { txLink } from "./resolve.ts";

/** The live status card (`status` kind): what `hako_execute`, `hako_request_status` and `hako_broadcast` answer. */

/** Drafts signed as a wallet transaction and sent by Hako's broadcast job: PayBox `success` means signed, not sent. */
const WALLET_SIGNED: ReadonlySet<DraftKindName> = new Set(["swap", "bridge", "earn_deposit", "earn_withdraw"]);

/** Where the move is, from PayBox's status and the intent state. */
export function stageOf(kind: DraftKindName | null, status: PayboxRequestStatus | null, state: IntentState | null, sourceSent: boolean): MoveStage | null {
  const pending = status ? pendingRequestStage(status) : null;
  if (pending) return pending;
  if (state === "completed") return "confirmed";
  if (status !== "success" || !kind) return null;
  if (!WALLET_SIGNED.has(kind)) return kind === "send" ? "sent" : "confirmed";
  if (!sourceSent) return "sending";
  return kind === "bridge" ? "arriving" : "sent";
}

/** Hako's `/sign/<requestId>` page, which hosts PayBox's signing window for the user's own PayBox client. */
export const signUrlFor = (deps: Pick<AgentDeps, "appUrl">, requestId: string): string =>
  `${deps.appUrl.replace(/\/+$/, "")}${HAKO_APP_PATHS.sign}/${encodeURIComponent(requestId)}`;

export function requestRef(deps: Pick<AgentDeps, "appUrl">, requestId: string, status: PayboxRequestStatus, approvalUrl: string | null): RequestRef {
  return { id: requestId, status, approvalUrl, signUrl: status === "pending_signature" ? signUrlFor(deps, requestId) : null };
}

/** The chains a draft's transactions land on: its source, and a bridge's destination. x402 payments settle on Base. */
export function draftChains(view: DraftView): { source: Caip2; destination: Caip2 | null } {
  const input = view.input as Partial<Record<"chain" | "fromChain" | "toChain", Caip2>>;
  if (input.fromChain) return { source: input.fromChain, destination: input.toChain ?? null };
  return { source: input.chain ?? X402_NETWORK.caip2, destination: null };
}

/** The role of a draft's source transaction on its receipt line. */
export function sourceRole(kind: DraftKindName): TxLink["role"] {
  if (kind === "run" || kind === "invoice_pay") return "payment";
  if (kind === "send") return "transfer";
  if (kind === "earn_deposit") return "deposit";
  if (kind === "earn_withdraw") return "withdraw";
  return "source";
}

export function txLinks(view: DraftView, hashes: { source: string | null; destination: string | null }): TxLink[] {
  const chains = draftChains(view);
  const links: TxLink[] = [];
  if (hashes.source) links.push(txLink(chains.source, hashes.source, sourceRole(view.kind)));
  if (hashes.destination && chains.destination) links.push(txLink(chains.destination, hashes.destination, "destination"));
  return links;
}

export interface StatusParts extends Omit<StatusData, "updatedAt" | "waitsOn" | "signUrl" | "stage"> {
  phase: CardPhase;
}

export function statusCard(deps: AgentDeps, parts: StatusParts): StructuredContent<"status"> {
  const { phase, ...rest } = parts;
  const sourceSent = rest.txs.some((tx) => tx.role !== "approve" && tx.role !== "destination");
  const request = rest.requestId && rest.requestStatus ? requestRef(deps, rest.requestId, rest.requestStatus, rest.approvalUrl) : null;
  const data: StatusData = {
    ...rest,
    waitsOn: rest.requestStatus ? requestWaitsOn(rest.requestStatus) : null,
    stage: stageOf(rest.kind, rest.requestStatus, rest.state, sourceSent),
    signUrl: request?.signUrl ?? null,
    updatedAt: deps.now().toISOString(),
  };
  const intent = rest.draftId && rest.version && rest.state ? { id: rest.draftId, version: rest.version, state: rest.state } : undefined;
  return card("status", data, { phase, ...(intent ? { intent } : {}), ...(request ? { request } : {}) }, deps);
}
