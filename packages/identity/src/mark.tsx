// Kawase's web Mark (tamion/packages/ui-web/src/components/mark.tsx), ported as-is: a real entity mark with the kit's
// colours, a mono variant for dense lists, a labelled neutral disc when the artwork has not arrived, and an optional
// chain badge. Hako's additions: a remote logo (LI.FI's logoURI through the gateway proxy) before the disc, and a
// fallback name for keys the registry does not know. Never a stand-in logo.
import type { ReactNode } from "react";

import { MARKS, type MarkStem } from "./generated/index.ts";
import { FallbackDisc, fallbackLabel } from "./fallback-disc.tsx";
import { MARK_BADGE_RATIO, MARK_DEFAULT_SIZE, MARK_GLYPH_RATIO } from "./identity.config.ts";
import { LogoImage } from "./logo-image.tsx";
import { ENTITIES, type Entity, type MarkVariant } from "./registry.ts";

const byId = new Map(ENTITIES.map((entity) => [entity.id, entity]));

export const getEntity = (id: string): Entity | undefined => byId.get(id);

/** The file stem for a variant, falling back to the other variant, or undefined when nothing has been delivered. */
export const markFile = (entity: Entity, variant: MarkVariant): string | undefined =>
  entity.marks[variant] ?? entity.marks.color ?? entity.marks.mono;

export type MarkProps = {
  entity: Entity | string;
  size?: number;
  variant?: MarkVariant;
  /** Colour for the mono variant (a CSS colour; defaults to currentColor). */
  tint?: string;
  disc?: boolean;
  chainBadge?: Entity | string;
  /** A remote logo (e.g. LI.FI's `logoURI`) shown through the gateway proxy when the registry has no artwork. */
  logoUri?: string;
  /** The name to say and abbreviate when the key is not in the registry (e.g. a LI.FI tool's name). */
  name?: string;
  className?: string;
};

const resolve = (entity: Entity | string): Entity | undefined => (typeof entity === "string" ? getEntity(entity) : entity);
const join = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

export function Mark({ entity, size = MARK_DEFAULT_SIZE, variant = "color", tint, disc, chainBadge, logoUri, name: fallbackName, className }: MarkProps) {
  const resolved = resolve(entity);
  const stem = resolved ? markFile(resolved, variant) : undefined;
  const Component = stem && stem in MARKS ? MARKS[stem as MarkStem] : undefined;
  const name = resolved?.name ?? fallbackName ?? (typeof entity === "string" ? entity : "");
  const mono = variant === "mono" || (stem !== undefined && stem.endsWith("-mono"));
  const onDisc = disc ?? (resolved?.shape === "uncontained" && !mono);
  const badge = chainBadge ? resolve(chainBadge) : undefined;
  const box = { width: size, height: size };
  const label = resolved ? fallbackLabel(resolved) : fallbackLabel({ name });

  let body: ReactNode;
  if (!Component) {
    body = logoUri ? <LogoImage src={logoUri} label={label} size={size} /> : <FallbackDisc label={label} size={size} />;
  } else if (onDisc) {
    const glyph = Math.round(size * MARK_GLYPH_RATIO);
    body = (
      <span className="flex items-center justify-center overflow-hidden rounded-full border border-border bg-card" style={box}>
        <Component width={glyph} height={glyph} aria-hidden />
      </span>
    );
  } else {
    body = (
      <span className={join("block", resolved?.shape === "disc" && "overflow-hidden rounded-full")} style={box}>
        <Component
          width={size}
          height={size}
          aria-hidden
          {...(mono ? { fill: tint ?? "currentColor", style: { color: tint ?? "currentColor" } } : {})}
        />
      </span>
    );
  }

  return (
    <span role="img" aria-label={name} className={join("relative inline-block shrink-0", className)} style={box}>
      {body}
      {badge ? (
        <span className="absolute -end-0.5 -bottom-0.5 rounded-full bg-background p-px">
          <Mark entity={badge} size={Math.round(size * MARK_BADGE_RATIO)} variant="color" />
        </span>
      ) : null}
    </span>
  );
}
