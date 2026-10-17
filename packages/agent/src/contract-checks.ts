import type { DraftKindName, DraftQuoteData, RehearsalData } from "@hako/cards/contract";
import type { DraftKind, DraftQuote, Rehearsal } from "@hako/paybox";

/**
 * Compile-time checks that the card contract's zod schemas and @hako/paybox's money-intent types describe the same
 * shapes, so a draft's quote and rehearsal go into a card unchanged. A drift on either side fails `pnpm typecheck` here.
 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type DraftQuoteMatches = Assert<Equals<DraftQuote, DraftQuoteData>>;
export type RehearsalMatches = Assert<Equals<Rehearsal, RehearsalData>>;
export type DraftKindsMatch = Assert<Equals<DraftKind, DraftKindName>>;
