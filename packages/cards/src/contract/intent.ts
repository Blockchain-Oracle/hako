import { z } from "zod";

import type { CardPhase } from "./phase.ts";

/**
 * A money intent's states (Kawase's A2A task states, tamion/packages/intents/src/states.ts) and which moves are legal.
 * Every state change is checked against this table, so a stale tap or a replayed request cannot move an intent
 * backwards. A card follows `{id, version, state}`: each edit makes a new version, and a version is executed at most
 * once (plan §1, "One PayBox request per draft version").
 */
export const INTENT_STATES = [
  "submitted",
  "working",
  "input_required",
  "auth_required",
  "ready_for_approval",
  "approved",
  "executing",
  "completed",
  "failed",
  "rejected",
  "canceled",
  "expired",
  "unknown_outcome",
] as const;
export type IntentState = (typeof INTENT_STATES)[number];
export const intentStateSchema = z.enum(INTENT_STATES);

/** Nothing moves an intent out of these, except reconciliation settling an unknown outcome (which isn't one). */
export const FINAL_INTENT_STATES: ReadonlySet<IntentState> = new Set(["completed", "failed", "rejected", "canceled", "expired"]);

/** States in which a new draft version may be made (a fix arrived, the person edited the amount). */
export const DRAFTABLE_INTENT_STATES: ReadonlySet<IntentState> = new Set([
  "submitted",
  "working",
  "input_required",
  "auth_required",
  "ready_for_approval",
]);

const TRANSITIONS: Record<IntentState, readonly IntentState[]> = {
  submitted: ["working", "input_required", "auth_required", "ready_for_approval", "rejected", "canceled", "expired"],
  working: ["input_required", "auth_required", "ready_for_approval", "rejected", "canceled", "expired"],
  input_required: ["working", "input_required", "auth_required", "ready_for_approval", "rejected", "canceled", "expired"],
  auth_required: ["working", "input_required", "auth_required", "ready_for_approval", "rejected", "canceled", "expired"],
  ready_for_approval: ["working", "input_required", "auth_required", "ready_for_approval", "approved", "rejected", "canceled", "expired"],
  approved: ["executing", "failed", "canceled", "ready_for_approval"],
  executing: ["completed", "failed", "unknown_outcome"],
  unknown_outcome: ["completed", "failed"],
  completed: [],
  failed: [],
  rejected: [],
  canceled: [],
  expired: [],
};

export function canTransition(from: IntentState, to: IntentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export const isFinalIntentState = (state: IntentState): boolean => FINAL_INTENT_STATES.has(state);
export const isDraftableIntentState = (state: IntentState): boolean => DRAFTABLE_INTENT_STATES.has(state);

/** What a card follows: one draft, one version of it, its state. Versions start at 1. */
export const intentSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  state: intentStateSchema,
});
export type Intent = z.output<typeof intentSchema>;

const PHASE_BY_STATE = {
  submitted: "streaming",
  working: "streaming",
  input_required: "ready",
  auth_required: "ready",
  ready_for_approval: "ready",
  approved: "live",
  executing: "live",
  // "Checking whether this went through": the card keeps following until reconciliation settles it.
  unknown_outcome: "live",
  completed: "result",
  failed: "error",
  rejected: "denied",
  canceled: "cancelled",
  // An expired draft moved no money: it reads as stopped, with a fresh quote one tap away.
  expired: "cancelled",
} as const satisfies Record<IntentState, CardPhase>;

export const intentStateToPhase = (state: IntentState): CardPhase => PHASE_BY_STATE[state];

/**
 * What a draft can be (the keys of @hako/paybox's `DraftInputs`; @hako/agent checks the two stay equal): the five
 * money moves, a paid catalog run (a pay card) and paying a Hako invoice. Each runs as one PayBox request per version.
 */
export const DRAFT_KINDS = ["send", "swap", "bridge", "earn_deposit", "earn_withdraw", "run", "invoice_pay"] as const;
export type DraftKindName = (typeof DRAFT_KINDS)[number];
export const draftKindSchema = z.enum(DRAFT_KINDS);

/** One version of one draft: what `hako_execute`, `hako_broadcast` and the `(draft_id, version)` row are keyed by. */
export const draftRefSchema = z.object({
  draftId: z.string().min(1),
  version: z.number().int().min(1),
});
export type DraftRef = z.output<typeof draftRefSchema>;
