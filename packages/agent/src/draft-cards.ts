import {
  type Blocked,
  type CardPhase,
  type DraftCardKind,
  type DraftRef,
  intentStateToPhase,
  type RequestRef,
  type StructuredContent,
  type TokenRef,
} from "@hako/cards/contract";
import { sameAddress } from "@hako/money";
import { BASE, type Caip2, isExecutableCaip2, networkByCaip2 } from "@hako/networks";
import type { DraftKind, DraftView } from "@hako/paybox";

import { card } from "./define.ts";
import type { AgentDeps, OwnedDraft } from "./deps.ts";
import { AgentToolError, authRequired } from "./errors.ts";
import { familyOf, resolveToken } from "./resolve.ts";
import { draftChains } from "./status-cards.ts";

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
  const blocked = executableBlock(view);
  const envelope = {
    phase: live.phase ?? intentStateToPhase(view.state),
    intent: { id: view.id, version: view.version, state: view.state },
    ...(live.request ? { request: live.request } : {}),
    ...(blocked ? { blocked } : {}),
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

/**
 * R17 (`@hako/networks` executable list): only a source chain Hako executes on gets the action button. A draft from
 * any other chain is read-only, with the reason in words and one fix: the same draft from Base.
 */
export function executableBlock(view: DraftView): Blocked | undefined {
  const { source } = draftChains(view);
  if (isExecutableCaip2(source)) return undefined;
  const edit = view.kind === "bridge" ? { fromChain: BASE.key } : { chain: BASE.key };
  return {
    reason: `Hako can't move money from ${networkByCaip2(source)?.name ?? source} yet`,
    fix: "change_network",
    action: { type: "tool", label: `Switch to ${BASE.name}`, tool: "hako_draft_update", input: { draftId: view.id, version: view.version, edit } },
  };
}

/**
 * A draft version the caller may see, or a not-found error. A draft a signed-in user owns is refused to an anonymous
 * caller (sign in first) and hidden from every other user.
 */
function ownedView(deps: AgentDeps, owned: OwnedDraft | null, draftId: string, tool: string): DraftView {
  const notFound = new AgentToolError("not_found", `No draft ${draftId}: it may have expired. Ask for a fresh quote.`);
  if (!owned) throw notFound;
  if (owned.ownerUserId !== null) {
    if (!deps.user) throw authRequired(tool);
    if (deps.user.id !== owned.ownerUserId) throw notFound;
  }
  return owned.view;
}

/** The latest version of one of the caller's drafts. */
export async function loadDraft(deps: AgentDeps, draftId: string, tool: string): Promise<DraftView> {
  return ownedView(deps, await deps.drafts.getDraft(draftId), draftId, tool);
}

/** One stored version of one of the caller's drafts (the version a revision wrote), whatever landed after it. */
export async function loadDraftAt(deps: AgentDeps, ref: DraftRef, tool: string): Promise<DraftView> {
  return ownedView(deps, await deps.drafts.getVersion(ref.draftId, ref.version), ref.draftId, tool);
}

/** `stale_version` for a card behind the store, carrying the latest card to draw instead. */
export async function staleVersion(deps: AgentDeps, latest: DraftView): Promise<AgentToolError> {
  const card = isMoveDraft(latest.kind) ? await draftCard(latest, deps) : null;
  const message = `This card is out of date: the draft is at version ${latest.version} now. Make the change on the latest card.`;
  return new AgentToolError("stale_version", message, { card });
}

/**
 * The draft at the version its card shows. A card behind the store (another edit landed first, or the card was
 * re-mounted from an old message) is refused with `stale_version`, carrying the latest card to draw instead.
 */
export async function loadDraftVersion(deps: AgentDeps, ref: DraftRef, tool: string): Promise<DraftView> {
  const view = await loadDraft(deps, ref.draftId, tool);
  if (view.version === ref.version) return view;
  throw await staleVersion(deps, view);
}
