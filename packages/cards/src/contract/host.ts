import { z } from "zod";

import { decimalAmountSchema } from "./primitives.ts";
import type { HakoToolName } from "./tools.ts";
import type { StructuredContent } from "./registry.ts";

/**
 * How much a card shows (plan §1 card flow, "Same component everywhere, with host density"): `full` in `/agent` (every
 * field, Kawase pickers); `inline` inside MCP hosts (about five data points, network and token as chips, amount as
 * inline text, at most two actions: "<Verb> with PayBox" and "Full view").
 */
export const CARD_DENSITIES = ["full", "inline"] as const;
export type CardDensity = (typeof CARD_DENSITIES)[number];
export const cardDensitySchema = z.enum(CARD_DENSITIES);

/**
 * An edit from a draft card, in the person's terms: chains as a network key or CAIP-2 id, tokens as a symbol or an
 * address, the amount in token units. `hako_draft_update` resolves them and makes the next draft version.
 */
export const draftEditSchema = z
  .object({
    amount: decimalAmountSchema,
    chain: z.string().min(1),
    fromChain: z.string().min(1),
    toChain: z.string().min(1),
    token: z.string().min(1),
    fromToken: z.string().min(1),
    toToken: z.string().min(1),
    /** A send's recipient: an address, a saved contact's name or a PayBox username. */
    to: z.string().min(1),
    vault: z.string().min(1),
    /** A route-race row picked before signing: every later quote pins `allowBridges=[tool]`. */
    tool: z.string().min(1),
  })
  .partial();
export type DraftEdit = z.input<typeof draftEditSchema>;

/**
 * What a card can ask of the surface that renders it (plan §3 "Cards everywhere"). `/agent` implements it over the AI
 * SDK chat and its route handlers; the MCP view over the MCP Apps bridge (`callServerTool`, `sendMessage`,
 * `openLink`, `updateModelContext`). Cards never fetch or navigate by themselves, so the same card runs in both.
 */
export interface CardHost {
  readonly density: CardDensity;
  /** Calls a Hako tool from a card button (`hako_execute`, `hako_request_status`, `hako_refresh`…) and returns its card. */
  runTool(name: HakoToolName, input: Record<string, unknown>): Promise<StructuredContent>;
  /** A chip or "Ask Hako": sends the text as the person's next turn. */
  sendPrompt(text: string): void;
  /** Opens a link outside the card: PayBox's approval page, `/sign/<id>`, an explorer, a buy link. */
  openLink(url: string): void;
  /** An in-place edit: `hako_draft_update` makes a new draft version, re-quoted and re-rehearsed, and returns its card. */
  requote(draftId: string, edit: DraftEdit): Promise<StructuredContent>;
  /** The card reached its end (a receipt, a failure that says whether money moved): the conversation keeps it. */
  complete(result: StructuredContent): void;
}
