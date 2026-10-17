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
