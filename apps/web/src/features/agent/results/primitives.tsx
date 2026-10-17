"use client";

import { AlertTriangle, ChevronDown, ExternalLink } from "lucide-react";
import Image from "next/image";
import { Children, Fragment, type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

import { CLAMP_BREAK_MIN_SHARE } from "./constants";
import { cutText, formatAbsolute, formatRelative } from "./format";
import { safeHref } from "./parse";
import { useNow } from "./useNow";

/** Monid's mono micro-label. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase", className)}>
      {children}
    </p>
  );
}

export function Section({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-4 border-t border-line pt-3", className)}>
      <Label>{label}</Label>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A link to somewhere else, only when the URL is http(s); otherwise the label as plain text. */
export function ExtLink({
  href,
  children,
  className,
  icon = false,
  title,
}: {
  href: unknown;
  children: ReactNode;
  className?: string;
  icon?: boolean;
  title?: string;
}) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={title ?? safe}
      className={cn("text-brand underline-offset-4 hover:underline", icon && "inline-flex items-center gap-1", className)}
    >
      {children}
      {icon && <ExternalLink className="size-3 shrink-0" aria-hidden />}
    </a>
  );
}

const PILL_TONES = {
  neutral: "bg-muted text-ink-2",
  brand: "bg-brand/[0.07] text-brand",
  success: "bg-success/[0.08] text-success",
  outline: "border border-line-default text-ink-2",
  strong: "bg-dark text-background",
} as const;

export type PillTone = keyof typeof PILL_TONES;

export function Pill({ children, tone = "neutral", className, title }: {
  children: ReactNode;
  tone?: PillTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[0.625rem] leading-none tracking-[0.08em] whitespace-nowrap uppercase",
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Items separated by middots; empty items are dropped. */
export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  // toArray already drops null, undefined and booleans (the `cond && x` that came out false).
  const items = Children.toArray(children).filter((c) => c !== "");
  if (items.length === 0) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground", className)}>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden>·</span>}
          {item}
        </Fragment>
      ))}
    </p>
  );
}

/** "4 min ago" with the absolute time on hover; text that is not a date shows as given. */
export function TimeAgo({ value, className }: { value: unknown; className?: string }) {
  const now = useNow();
  const relative = formatRelative(value, now);
  if (!relative) return null;
  const absolute = formatAbsolute(value) ?? undefined;
  return (
    <time dateTime={typeof value === "string" ? value : undefined} title={absolute} className={className}>
      {relative}
    </time>
  );
}

/** The first `limit` items, and the toggle state for the rest. */
export function usePreview<T>(items: T[], limit: number) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, limit);
  return { shown, expanded, hidden: items.length - shown.length, toggle: () => setExpanded((e) => !e), total: items.length };
}

export function ShowAll({ total, limit, expanded, onToggle, noun = "items", className }: {
  total: number;
  limit: number;
  expanded: boolean;
  onToggle: () => void;
  noun?: string;
  className?: string;
}) {
  if (total <= limit) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "mt-2 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand underline-offset-4 hover:underline",
        className,
      )}
    >
      {expanded ? "Show fewer" : `Show all ${total} ${noun}`}
      <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
    </button>
  );
}

/** Plain text cut at `chars` with a Show more toggle; whitespace and line breaks are kept. */
export function ClampText({ text, chars, className }: { text: string; chars: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > chars;
  return (
    <div className={className}>
      <p className="break-words whitespace-pre-line">{open || !long ? text : cutText(text, chars, CLAMP_BREAK_MIN_SHARE)}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 text-[0.8125rem] font-medium text-brand underline-offset-4 hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export type KeyValueRow = [label: string, value: ReactNode];

export function KeyValues({ rows, className }: { rows: KeyValueRow[]; className?: string }) {
  const present = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (present.length === 0) return null;
  return (
    <dl className={cn("grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]", className)}>
      {present.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="truncate text-muted-foreground" title={label}>
            {label}
          </dt>
          <dd className="min-w-0 break-words text-ink-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0" title={title}>
      <p className="truncate font-mono text-[0.9375rem] font-semibold text-foreground">{value}</p>
      <Label className="mt-0.5 text-[0.625rem]">{label}</Label>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-sm bg-subtle px-3 py-2.5 text-[0.8125rem] text-muted-foreground">{children}</p>;
}

/** A calm callout for deprecations, retractions and conflicts (the palette has no alarm colour, on purpose). */
export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-sm border border-line-default bg-muted px-3 py-2 text-[0.8125rem] text-foreground",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/**
 * A remote image, unoptimized (provider hosts are not in next.config), only from an http(s) URL, sent without a
 * referrer. A broken image (hotlink refusals are common) becomes a quiet grey tile of the same size.
 */
export function Thumb({ src, alt, width, height, className }: {
  src: unknown;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const safe = safeHref(src);
  if (!safe) return null;
  if (failed) return <span aria-hidden className={cn("block shrink-0 rounded-sm bg-muted", className)} />;
  return (
    <Image
      src={safe}
      alt={alt}
      width={width}
      height={height}
      unoptimized
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-sm border border-line bg-muted object-cover", className)}
    />
  );
}
