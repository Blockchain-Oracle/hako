/**
 * Compile-time checks that the shapes other packages own still fit the money-intent contract (no runtime code):
 * @hako/db's draft kinds are exactly `DraftKind`, and @hako/defi's normalised quote is a `DraftQuote`.
 */
import type { DRAFT_KINDS } from "@hako/db/node";
import type { NormalizedQuote } from "@hako/defi/core";

import type { DraftKind, DraftQuote } from "./intents/types.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type DraftKindsMatchDb = Assert<Equal<DraftKind, (typeof DRAFT_KINDS)[number]>>;
export type NormalizedQuoteIsDraftQuote = Assert<NormalizedQuote extends DraftQuote ? true : false>;
