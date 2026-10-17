import { z } from "zod";

/**
 * Every card is in exactly one phase (plan §3 "Cards everywhere"), the same in `/agent` and in the MCP Apps view:
 * - streaming: the tool call's input is still arriving or the draft is being built;
 * - ready: a draft or pay card waiting for the user's one button;
 * - live: following a PayBox request or a move in flight (approval, signature, sent, arriving);
 * - result: done, with what arrived and its receipt;
 * - error: failed, and the card says whether money moved;
 * - denied: PayBox or the user refused it (a policy, a limit, a passkey "no");
 * - cancelled: stopped before any money moved (the user cancelled, the draft expired, PayBox was reconnected).
 */
export const CARD_PHASES = ["streaming", "ready", "live", "result", "error", "denied", "cancelled"] as const;
export type CardPhase = (typeof CARD_PHASES)[number];
export const cardPhaseSchema = z.enum(CARD_PHASES);

/** Phases a card never leaves; polling stops here. */
export const TERMINAL_CARD_PHASES: ReadonlySet<CardPhase> = new Set(["result", "error", "denied", "cancelled"]);

export const isTerminalCardPhase = (phase: CardPhase): boolean => TERMINAL_CARD_PHASES.has(phase);

/**
 * Where a money move is inside the `live` phase and at its end (plan §1 card flow step 3: "Signing → Sent →
 * Confirmed/Arriving"), so every surface says the same words:
 * - approval: waiting for the person's passkey in PayBox (`pending_approval`);
 * - funding: waiting for money to arrive in the wallet (`pending_funding`);
 * - signing: PayBox's signing window or the paired key signs (`pending_signature`);
 * - sending: Hako's broadcast job checks the signed transaction and sends it (a wallet sign's `success` means signed);
 * - sent: on chain, waiting for its receipt (`pending_confirmation`, a broadcast tx);
 * - arriving: the source leg confirmed, the bridge is filling the destination (`pending_settlement`, LI.FI status);
 * - confirmed / reverted / refused: the end (refused = a signed tx Hako would not send: stale nonce, expired blockhash,
 *   failing re-simulation, so no money moved).
 */
export const MOVE_STAGES = [
  "approval",
  "funding",
  "signing",
  "sending",
  "sent",
  "arriving",
  "confirmed",
  "reverted",
  "refused",
] as const;
export type MoveStage = (typeof MOVE_STAGES)[number];
export const moveStageSchema = z.enum(MOVE_STAGES);

/**
 * The failure card's first line (plan §1 card flow step 4: "A failure card always says whether money moved"): `no`
 * when nothing left the wallet, `yes` when a transfer landed (a bridge refund, a reverted destination), `unknown` while
 * Hako reconciles an outcome it could not read ("Checking whether this went through").
 */
export const MONEY_MOVED = ["no", "yes", "unknown"] as const;
export type MoneyMoved = (typeof MONEY_MOVED)[number];
export const moneyMovedSchema = z.enum(MONEY_MOVED);
