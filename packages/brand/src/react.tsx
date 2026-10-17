/**
 * The seal and wordmark as React components, shared by apps/web and apps/docs. Colours come from tokens only:
 * frame, glyph and letters take the current text colour; the check is var(--primary), the mark's one colour.
 */
import { BRAND } from "./index";
import { SEAL, WORDMARK } from "./marks.generated";

const DEFAULT_SEAL_LABEL = `${BRAND.name} ${BRAND.kanji} seal`;
const CHECK_STYLE = { stroke: "var(--primary)" } as const;

function join(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** `label={null}` marks the seal decorative (when a visible name stands next to it). */
export function Seal({ className, label = DEFAULT_SEAL_LABEL }: { className?: string; label?: string | null }) {
  const a11y = label === null ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return (
    <svg viewBox={SEAL.viewBox} className={join("shrink-0", className)} {...a11y}>
      <g fill="none" stroke="currentColor" strokeLinecap="square">
        <path d={SEAL.outer.d} strokeWidth={SEAL.outer.strokeWidth} />
        <path d={SEAL.inner.d} strokeWidth={SEAL.inner.strokeWidth} />
      </g>
      <path d={SEAL.glyph} fill="currentColor" />
      <polyline
        points={SEAL.check.points}
        fill="none"
        style={CHECK_STYLE}
        strokeWidth={SEAL.check.strokeWidth}
        strokeLinecap="square"
      />
    </svg>
  );
}

/** HAKO | 証, outlined. `kanji={false}` gives the letters alone, for next to the seal. */
export function Wordmark({ className, kanji = true }: { className?: string; kanji?: boolean }) {
  return (
    <svg
      viewBox={kanji ? WORDMARK.viewBox : WORDMARK.lettersViewBox}
      className={join("shrink-0", className)}
      role="img"
      aria-label={BRAND.wordmark}
    >
      <path d={WORDMARK.letters} fill="currentColor" />
      {kanji && (
        <>
          <path d={WORDMARK.rule.d} stroke="currentColor" strokeWidth={WORDMARK.rule.strokeWidth} />
          <path d={WORDMARK.kanji} fill="currentColor" />
        </>
      )}
    </svg>
  );
}
