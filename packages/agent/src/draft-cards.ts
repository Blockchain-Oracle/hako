import {
  type CardPhase,
  type DraftCardKind,
  intentStateToPhase,
  type RequestRef,
  type StructuredContent,
  type TokenRef,
} from "@hako/cards/contract";
import { sameAddress } from "@hako/money";
import type { Caip2 } from "@hako/networks";
import type { DraftKind, DraftView } from "@hako/paybox";

import { card } from "./define.ts";
import type { AgentDeps } from "./deps.ts";
import { AgentToolError } from "./errors.ts";
import { familyOf, resolveToken } from "./resolve.ts";

/**
 * A draft as its card shows it: the version from the store (never from the client), its tokens resolved for display,
 * its quote and rehearsal unchanged, its phase from the intent state unless a live PayBox request says more. Drafts,
 * `hako_draft_update` and `hako_refresh` all draw through here.
 */

export type DraftCard = StructuredContent<DraftCardKind>;

const CARD_KIND: Record<Exclude<DraftKind, "run" | "invoice_pay">, DraftCardKind> = {
  send: "send_draft",
  swap: "swap_draft",
  bridge: "bridge_draft",
  earn_deposit: "earn_deposit_draft",
  earn_withdraw: "earn_withdraw_draft",
};

export const isMoveDraft = (kind: DraftKind): kind is keyof typeof CARD_KIND => kind in CARD_KIND;

function isKind<K extends DraftKind>(view: DraftView, kind: K): view is DraftView<K> {
  return view.kind === kind;
}

/** Live state to lay over the intent's own phase (a request waiting on approval, a refreshed status). */
export interface DraftLive {
  phase?: CardPhase;
  request?: RequestRef;
  /** Tokens the caller already resolved for this draft, so the card does not read them again. */
  known?: readonly TokenRef[];
}

export async function draftCard(view: DraftView, deps: AgentDeps, live: DraftLive = {}): Promise<DraftCard> {
  const tokenAt = async (chain: Caip2, address: string): Promise<TokenRef> =>
    live.known?.find((token) => token.chain === chain && sameAddress(token.address, address)) ?? resolveToken(deps, chain, address);
  const base = {
    draftId: view.id,
    version: view.version,
    state: view.state,
    quote: view.quote,
    rehearsal: view.rehearsal,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
  const envelope = {
    phase: live.phase ?? intentStateToPhase(view.state),
    intent: { id: view.id, version: view.version, state: view.state },
    ...(live.request ? { request: live.request } : {}),
  };
  if (isKind(view, "send")) {
    const { chain, token, amountAtomic, from, to, toLabel } = view.input;
    const family = familyOf(chain);
    const data = {
      ...base,
      chain,
      amount: { token: await tokenAt(chain, token), amountAtomic, usd: null },
      from: { address: from, family },
      to: { address: to, family, ...(toLabel ? { label: toLabel } : {}) },
    };
    return card("send_draft", data, envelope, deps);
  }
  if (isKind(view, "swap") || isKind(view, "bridge")) {
    const input = view.input;
    const [fromToken, toToken] = await Promise.all([tokenAt(input.fromChain, input.fromToken), tokenAt(input.toChain, input.toToken)]);
    const data = {
      ...base,
      fromChain: input.fromChain,
      toChain: input.toChain,
      amount: { token: fromToken, amountAtomic: input.fromAmountAtomic, usd: null },
      toToken,
      from: { address: input.fromAddress, family: familyOf(input.fromChain) },
      to: { address: input.toAddress, family: familyOf(input.toChain) },
      tool: input.tool ?? null,
    };
    return card(view.kind === "swap" ? "swap_draft" : "bridge_draft", data, envelope, deps);
  }
  if (isKind(view, "earn_deposit") || isKind(view, "earn_withdraw")) {
    const input = view.input;
    const data = {
      ...base,
      chain: input.chain,
      vault: { address: input.vault, name: null, protocol: null, apy: null },
      amount: { token: await tokenAt(input.chain, input.token), amountAtomic: input.amountAtomic, usd: null },
      wallet: { address: input.fromAddress, family: familyOf(input.chain) },
    };
    return card(view.kind === "earn_deposit" ? "earn_deposit_draft" : "earn_withdraw_draft", data, envelope, deps);
  }
  throw new AgentToolError("unsupported", `A ${view.kind} draft is shown on its own card (pay card or invoice), not a move card.`);
}

/** The latest version of a draft from the store, or a not-found error. */
export async function loadDraft(deps: AgentDeps, draftId: string): Promise<DraftView> {
  const view = await deps.drafts.getDraft(draftId);
  if (!view) throw new AgentToolError("not_found", `No draft ${draftId}: it may have expired. Ask for a fresh quote.`);
  return view;
}
