import "server-only";

import { FALLBACK_TITLE_MAX, NEW_CHAT_TITLE } from "@/lib/constants/agent";

const ELLIPSIS = "…";
const MIN_WORD_CUT = FALLBACK_TITLE_MAX / 2; // cut at a word boundary only when that keeps at least half the width

const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The chat's title in the sidebar: its first message, cut at a word boundary. */
export function fallbackTitle(text: string): string {
  const flat = flatten(text);
  if (!flat) return NEW_CHAT_TITLE;
  if (flat.length <= FALLBACK_TITLE_MAX) return flat;
  const cut = flat.slice(0, FALLBACK_TITLE_MAX);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > MIN_WORD_CUT ? cut.slice(0, atWord) : cut).trimEnd()}${ELLIPSIS}`;
}
