"use client";

import { CELL_CLAMP_CHARS } from "./constants";
import { formatSmart, parseDate } from "./format";
import { hostOf, isRecord, safeHref } from "./parse";
import { ExtLink, TimeAgo } from "./primitives";

// Columns whose numbers are labels, not quantities: no "2,025" for a year or "1,234" for an id.
const RAW_NUMBER_KEY = /(^|_)(year|id|rank|cid|code|isbn|zip|number|chain_id|pid|qid)$/i;

export function isScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/** A flat list of scalars reads as "a, b, c"; anything deeper is not drawn inline. */
export function isInlineList(value: unknown): value is Array<string | number> {
  return Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number");
}

export function isNumericColumn(name: string, values: unknown[]): boolean {
  return !RAW_NUMBER_KEY.test(name) && values.some((v) => typeof v === "number") && values.every((v) => v == null || typeof v === "number");
}

/** One value in a table cell or key/value row: numbers grouped, dates relative, URLs as host links. */
export function ScalarValue({ name, value, clamp = CELL_CLAMP_CHARS }: { name: string; value: unknown; clamp?: number }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return <span>{value ? "yes" : "no"}</span>;
  if (typeof value === "number") {
    return RAW_NUMBER_KEY.test(name) ? <span>{String(value)}</span> : <span title={String(value)}>{formatSmart(value)}</span>;
  }
  if (isInlineList(value)) {
    return <ScalarValue name={name} value={value.map(String).join(", ")} clamp={clamp} />;
  }
  if (typeof value !== "string") {
    const json = JSON.stringify(value) ?? "";
    return <span className="font-mono text-[0.75rem] text-muted-foreground" title={json}>{json.length > clamp ? `${json.slice(0, clamp)}…` : json}</span>;
  }
  if (safeHref(value) && /^https?:\/\//i.test(value)) {
    return <ExtLink href={value} icon>{hostOf(value) ?? value}</ExtLink>;
  }
  const date = parseDate(value);
  if (date && !date.dateOnly) return <TimeAgo value={value} />;
  return <span title={value.length > clamp ? value : undefined}>{value.length > clamp ? `${value.slice(0, clamp)}…` : value}</span>;
}

/** Entries of an object that can be drawn inline (scalars and flat lists). */
export function inlineEntries(o: Record<string, unknown>, skip: ReadonlySet<string> = new Set()): Array<[string, unknown]> {
  return Object.entries(o).filter(([k, v]) => !skip.has(k) && (isScalar(v) || isInlineList(v)) && v !== null && v !== "");
}

export function isFlatRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((v) => isScalar(v) || isInlineList(v));
}
