import type { DraftEdit, TokenRef } from "@hako/cards/contract";
import { rescaleAtomic, sameAddress } from "@hako/money";
import type { Caip2 } from "@hako/networks";
import type { DraftInput, DraftKind, DraftView, EarnInput, RouteInput, SendInput } from "@hako/paybox";

import type { AgentDeps } from "./deps.ts";
import { AgentToolError } from "./errors.ts";
import { atomicAmount, familyOf, resolveChain, resolveRecipient, resolveToken, senderFor } from "./resolve.ts";

/**
 * An in-place edit from a draft card (plan §1 card flow step 2: network, token, amount, recipient, route) turned into
 * the next draft version's input. Tokens follow a chain change by symbol, an amount keeps its value when the token's
 * decimals change, and the sender follows a change of chain family to the user's own wallet there.
 */

export interface NextInput {
  input: DraftInput;
  /** Tokens resolved on the way, handed to the card so it reads none of them again. */
  known: TokenRef[];
}

/** The token on `chain` the edit means: the one named, or the current one carried over to a new chain by symbol. */
async function nextToken(deps: AgentDeps, from: { chain: Caip2; token: TokenRef }, chain: Caip2, edit: string | undefined): Promise<TokenRef> {
  if (edit) return resolveToken(deps, chain, edit);
  if (chain === from.chain) return from.token;
  return resolveToken(deps, chain, from.token.symbol);
}

function nextAmount(edit: string | undefined, atomic: string, before: TokenRef, after: TokenRef): string {
  if (edit) return atomicAmount(edit, after);
  return rescaleAtomic(BigInt(atomic), before.decimals, after.decimals).toString();
}

const chainOr = (value: string | undefined, current: Caip2): Caip2 => (value ? resolveChain(value) : current);

/** The sender after a chain change: unchanged within a family, the user's wallet for a new family. */
async function nextSender(deps: AgentDeps, current: string, before: Caip2, after: Caip2): Promise<string> {
  if (familyOf(before) === familyOf(after)) return current;
  return (await senderFor(deps, after, undefined, "hako_draft_update")).address;
}

async function nextSend(deps: AgentDeps, input: SendInput, edit: DraftEdit): Promise<NextInput> {
  const chain = chainOr(edit.chain, input.chain);
  const before = await resolveToken(deps, input.chain, input.token);
  const token = await nextToken(deps, { chain: input.chain, token: before }, chain, edit.token);
  const recipient = edit.to ? await resolveRecipient(deps, edit.to, chain) : null;
  if (!recipient && familyOf(chain) !== familyOf(input.chain)) {
    throw new AgentToolError("invalid_input", "The recipient's address is for another chain family: say who to send to on the new chain.");
  }
  const next: SendInput = {
    chain,
    token: token.address,
    amountAtomic: nextAmount(edit.amount, input.amountAtomic, before, token),
    from: await nextSender(deps, input.from, input.chain, chain),
    to: recipient?.address ?? input.to,
    ...(recipient?.label ? { toLabel: recipient.label } : input.toLabel && !recipient ? { toLabel: input.toLabel } : {}),
  };
  return { input: next, known: [token] };
}

async function nextRoute(deps: AgentDeps, kind: "swap" | "bridge", input: RouteInput, edit: DraftEdit): Promise<NextInput> {
  const fromChain = chainOr(edit.fromChain ?? edit.chain, input.fromChain);
  // A swap stays on one chain: its destination follows its source.
  const toChain = kind === "swap" ? fromChain : chainOr(edit.toChain, input.toChain);
  const [fromBefore, toBefore] = await Promise.all([resolveToken(deps, input.fromChain, input.fromToken), resolveToken(deps, input.toChain, input.toToken)]);
  const [fromToken, toToken] = await Promise.all([
    nextToken(deps, { chain: input.fromChain, token: fromBefore }, fromChain, edit.fromToken ?? edit.token),
    nextToken(deps, { chain: input.toChain, token: toBefore }, toChain, edit.toToken),
  ]);
  const fromAddress = await nextSender(deps, input.fromAddress, input.fromChain, fromChain);
  // A recipient edit names an address, a contact or a PayBox username, resolved for the destination chain's family;
  // otherwise the recipient stays, or follows a change of family to the user's own wallet there.
  const toAddress = edit.to
    ? (await resolveRecipient(deps, edit.to, toChain)).address
    : await nextSender(deps, input.toAddress, input.toChain, toChain);
  // A new route or a new pair drops the pinned tool unless the edit picks one: the race runs again.
  const routeChanged =
    fromChain !== input.fromChain || toChain !== input.toChain || !sameAddress(fromToken.address, input.fromToken) || !sameAddress(toToken.address, input.toToken);
  const tool = edit.tool ?? (routeChanged ? undefined : input.tool);
  const next: RouteInput = {
    fromChain,
    toChain,
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromAmountAtomic: nextAmount(edit.amount, input.fromAmountAtomic, fromBefore, fromToken),
    fromAddress,
    toAddress,
    ...(tool ? { tool } : {}),
  };
  return { input: next, known: [fromToken, toToken] };
}

async function nextEarn(deps: AgentDeps, input: EarnInput, edit: DraftEdit): Promise<NextInput> {
  const chain = chainOr(edit.chain, input.chain);
  if (familyOf(chain) !== "evm") throw new AgentToolError("unsupported", "LI.FI Earn runs on EVM chains only.");
  const before = await resolveToken(deps, input.chain, input.token);
  const token = await nextToken(deps, { chain: input.chain, token: before }, chain, edit.token);
  const next: EarnInput = {
    chain,
    vault: edit.vault ?? input.vault,
    token: token.address,
    amountAtomic: nextAmount(edit.amount, input.amountAtomic, before, token),
    fromAddress: input.fromAddress,
  };
  return { input: next, known: [token] };
}

const is = <K extends DraftKind>(view: DraftView, kind: K): view is DraftView<K> => view.kind === kind;

/** The next version's whole input (a valid patch: every field set), or why this draft can't be edited. */
export async function nextInput(deps: AgentDeps, view: DraftView, edit: DraftEdit): Promise<NextInput> {
  if (is(view, "send")) return nextSend(deps, view.input, edit);
  if (is(view, "swap") || is(view, "bridge")) return nextRoute(deps, view.kind, view.input, edit);
  if (is(view, "earn_deposit") || is(view, "earn_withdraw")) return nextEarn(deps, view.input, edit);
  throw new AgentToolError("unsupported", `A ${view.kind} draft has nothing to edit: run the tool again with the new input.`);
}
