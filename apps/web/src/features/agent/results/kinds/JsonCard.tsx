"use client";

import { ChevronRight } from "lucide-react";

import { JSON_CHILDREN_PREVIEW, JSON_OPEN_DEPTH, JSON_STRING_CLAMP_CHARS } from "../constants";
import { isRecord } from "../parse";
import { ClampText, ShowAll, usePreview } from "../primitives";

type Entry = [key: string, value: unknown];

function Primitive({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">null</span>;
  if (typeof value === "string") {
    return <ClampText text={JSON.stringify(value)} chars={JSON_STRING_CLAMP_CHARS} className="min-w-0 break-all text-ink-2" />;
  }
  if (typeof value === "number" || typeof value === "boolean") return <span className="text-brand">{String(value)}</span>;
  return <span className="text-muted-foreground">{typeof value}</span>;
}

function Entries({ entries, depth }: { entries: Entry[]; depth: number }) {
  const { shown, expanded, toggle, total } = usePreview(entries, JSON_CHILDREN_PREVIEW);
  return (
    <div className="ml-1.5 border-l border-line pl-3">
      {shown.map(([key, value]) => (
        <Node key={key} name={key} value={value} depth={depth + 1} />
      ))}
      <ShowAll total={total} limit={JSON_CHILDREN_PREVIEW} expanded={expanded} onToggle={toggle} noun="entries" className="text-xs" />
    </div>
  );
}

function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const label = name !== undefined ? <span className="shrink-0 text-foreground">{name}:</span> : null;
  if (Array.isArray(value) || isRecord(value)) {
    const entries: Entry[] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) {
      return (
        <div className="flex gap-1.5 py-px">
          {label}
          <span className="text-muted-foreground">{`${open}${close}`}</span>
        </div>
      );
    }
    return (
      // Only this node's own chevron turns: a group-open variant would turn every nested one too.
      <details open={depth < JSON_OPEN_DEPTH} className="py-px [&[open]>summary>svg]:rotate-90">
        <summary className="flex cursor-pointer list-none items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform" aria-hidden />
          {label}
          <span className="text-muted-foreground">
            {open}
            {entries.length}
            {close}
          </span>
        </summary>
        <Entries entries={entries} depth={depth} />
      </details>
    );
  }
  return (
    <div className="flex min-w-0 gap-1.5 py-px">
      {label}
      <Primitive value={value} />
    </div>
  );
}

/** Anything without a dedicated card: a collapsible tree, mono on the subtle surface. */
export function JsonCard({ data }: { data: unknown }) {
  return (
    <div className="overflow-x-auto rounded-sm border border-line bg-subtle p-3 font-mono text-xs leading-relaxed">
      <Node value={data} depth={0} />
    </div>
  );
}
