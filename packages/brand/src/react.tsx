/**
 * The Hako mark and lockup as React components, shared by apps/web, apps/docs and the cards. Colours come from tokens
 * only: the body takes the current text colour and the lid the accent (`var(--accent)`); `tone="mono"` draws the whole
 * mark in the current colour (dense rows, the inverse plate).
 */
import { BRAND } from "./index.ts";
import { MARK } from "../generated/mark.ts";

const DEFAULT_LABEL = BRAND.name;
const LID_ACCENT = { fill: "var(--accent)" } as const;

export type HakoMarkProps = {
  className?: string;
  /** `null` marks it decorative (when the name stands next to it). */
  label?: string | null;
  tone?: "accent" | "mono";
};

export function HakoMark({ className, label = DEFAULT_LABEL, tone = "accent" }: HakoMarkProps) {
  const a11y = label === null ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return (
    <svg viewBox={MARK.viewBox} className={["shrink-0", className].filter(Boolean).join(" ")} {...a11y}>
      <path d={MARK.body} fill="currentColor" fillRule="evenodd" />
      <path d={MARK.lid} fill="currentColor" style={tone === "accent" ? LID_ACCENT : undefined} />
    </svg>
  );
}

/** The mark beside "Hako" in the display face; the caller sizes it through `className` (font size). */
export function HakoLockup({ className, tone = "accent" }: { className?: string; tone?: HakoMarkProps["tone"] }) {
  return (
    <span className={["inline-flex items-center gap-[0.3em] font-display font-black tracking-[-0.02em]", className].filter(Boolean).join(" ")}>
      <HakoMark className="size-[1.15em]" label={null} tone={tone} />
      <span>{BRAND.name}</span>
    </span>
  );
}
