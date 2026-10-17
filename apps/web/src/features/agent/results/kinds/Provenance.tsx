"use client";

import { formatPercent } from "../format";
import { num, type Rec, str, strings } from "../parse";
import { Pill, type PillTone } from "../primitives";

/** Hako's cross-checked tools say whether their sources agreed (hako_core Agreement). */
const AGREEMENT: Record<string, { label: string; tone: PillTone }> = {
  agree: { label: "Sources agree", tone: "success" },
  minor_diff: { label: "Minor differences", tone: "neutral" },
  conflict: { label: "Sources disagree", tone: "strong" },
  single_source: { label: "Single source", tone: "outline" },
};

const FRESHNESS: Record<string, { label: string; tone: PillTone }> = {
  lagging: { label: "Lagging", tone: "neutral" },
  stale: { label: "Stale", tone: "strong" },
};

export function AgreementPill({ provenance }: { provenance: Rec }) {
  const kind = AGREEMENT[str(provenance.agreement) ?? ""];
  if (!kind) return null;
  const spread = num(provenance.spread_pct);
  const sources = strings(provenance.sources);
  const title = [sources.length ? `Sources: ${sources.join(", ")}` : null, spread !== null ? `Spread ${formatPercent(spread, false)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pill tone={kind.tone} title={title || undefined}>
      {kind.label}
    </Pill>
  );
}

/** Only drawn when the data is not fresh: a fresh reading needs no badge. */
export function FreshnessPill({ provenance }: { provenance: Rec }) {
  const freshness = str(provenance.freshness);
  const kind = FRESHNESS[freshness ?? ""];
  return kind ? <Pill tone={kind.tone}>{kind.label}</Pill> : null;
}
