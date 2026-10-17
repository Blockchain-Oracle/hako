import { FALLBACK_INITIALS_MAX, FALLBACK_LABEL_SHORT, FALLBACK_RATIO_LONG, FALLBACK_RATIO_SHORT } from "./identity.config.ts";
import type { Entity } from "./registry.ts";

/** What the neutral fallback disc shows: the symbol, or the first letters of the name. */
export const fallbackLabel = (entity: Pick<Entity, "name" | "symbol">): string =>
  entity.symbol ??
  entity.name
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, FALLBACK_INITIALS_MAX)
    .toUpperCase();

/** Font size for the fallback label so a symbol like USDC still fits the disc. */
export const fallbackFontSize = (label: string, size: number): number =>
  Math.round(size * (label.length <= FALLBACK_LABEL_SHORT ? FALLBACK_RATIO_SHORT : FALLBACK_RATIO_LONG));

/** The labelled neutral disc: what an entity shows until its real artwork is delivered. Never a stand-in logo. */
export function FallbackDisc({ label, size }: { label: string; size: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-full border border-border bg-muted font-semibold text-muted-foreground"
      style={{ width: size, height: size, fontSize: fallbackFontSize(label, size) }}
    >
      {label}
    </span>
  );
}
