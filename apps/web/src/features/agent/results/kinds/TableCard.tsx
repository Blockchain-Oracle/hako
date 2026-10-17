"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { KV_PREVIEW, TABLE_MAX_COLUMNS, TABLE_PREVIEW_ROWS } from "../constants";
import { humanize } from "../format";
import { isRecord, type Rec, records, rowKey, safeHref, str } from "../parse";
import { Empty, ExtLink, KeyValues, Section, ShowAll, usePreview } from "../primitives";
import { inlineEntries, isFlatRecord, isNumericColumn, ScalarValue } from "../Value";

const ROW_KEYS = ["rows", "items", "results"];
const LINK_KEYS = ["url", "link", "href"];
// The column that carries the row's link, in order of preference.
const TITLE_KEYS = ["title", "name", "word", "article", "label", "place", "text", "id"];

function columnsOf(rows: Rec[]): string[] {
  const seen = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => seen.add(key)));
  return [...seen].filter((key) => rows.some((row) => row[key] !== null && row[key] !== undefined && row[key] !== ""));
}

/** rows[] of flat objects as a compact table: first rows and columns, with toggles for the rest. */
export function DataTable({ rows }: { rows: Rec[] }) {
  const { shown, expanded, toggle, total } = usePreview(rows, TABLE_PREVIEW_ROWS);
  const [wide, setWide] = useState(false);
  const present = columnsOf(rows);
  const linkKey = LINK_KEYS.find((key) => rows.some((row) => safeHref(row[key])));
  const titleKey = linkKey ? TITLE_KEYS.find((key) => present.includes(key)) : undefined;
  const all = titleKey ? present.filter((key) => key !== linkKey) : present;
  const columns = wide ? all : all.slice(0, TABLE_MAX_COLUMNS);
  const numeric = new Set(columns.filter((key) => isNumericColumn(key, rows.map((row) => row[key]))));
  if (rows.length === 0) return <Empty>No rows.</Empty>;
  return (
    <div>
      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="w-full border-collapse text-left text-[0.8125rem]">
          <thead>
            <tr>
              {columns.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className={cn(
                    "border-b border-line bg-subtle px-2.5 py-1.5 font-mono text-[0.625rem] font-normal tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase",
                    numeric.has(key) && "text-right",
                  )}
                >
                  {humanize(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={rowKey(row, index)} className="border-b border-line last:border-0">
                {columns.map((key) => (
                  <td
                    key={key}
                    className={cn(
                      "max-w-[28rem] px-2.5 py-1.5 align-top text-ink-2",
                      numeric.has(key) && "text-right font-mono whitespace-nowrap tabular-nums",
                      key === titleKey && "min-w-[9rem] font-medium text-foreground",
                    )}
                  >
                    {key === titleKey && linkKey && safeHref(row[linkKey]) ? (
                      <ExtLink href={row[linkKey]} className="text-foreground hover:text-brand">
                        {str(row[key]) ?? "open"}
                      </ExtLink>
                    ) : (
                      <ScalarValue name={key} value={row[key]} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4">
        <ShowAll total={total} limit={TABLE_PREVIEW_ROWS} expanded={expanded} onToggle={toggle} noun="rows" />
        {all.length > TABLE_MAX_COLUMNS && (
          <button
            type="button"
            onClick={() => setWide((w) => !w)}
            className="mt-2 text-[0.8125rem] font-medium text-brand underline-offset-4 hover:underline"
          >
            {wide ? "Fewer columns" : `All ${all.length} columns`}
          </button>
        )}
      </div>
    </div>
  );
}

/** Top-level facts next to the rows (query, totals, period) as one quiet line. */
export function Summary({ data, skip }: { data: Rec; skip: ReadonlySet<string> }) {
  const entries = inlineEntries(data, skip);
  if (entries.length === 0) return null;
  return (
    <dl className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 gap-1.5">
          <dt className="text-muted-foreground">{humanize(key)}</dt>
          <dd className="min-w-0 truncate text-foreground">
            <ScalarValue name={key} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** An object with no rows: its flat fields as key/value pairs. */
export function ObjectFields({ data }: { data: Rec }) {
  const entries = inlineEntries(data);
  const { shown, expanded, toggle, total } = usePreview(entries, KV_PREVIEW);
  if (entries.length === 0) return <Empty>No fields to show.</Empty>;
  return (
    <div>
      <KeyValues rows={shown.map(([key, value]) => [humanize(key), <ScalarValue key={key} name={key} value={value} />])} />
      <ShowAll total={total} limit={KV_PREVIEW} expanded={expanded} onToggle={toggle} noun="fields" />
    </div>
  );
}

export function TableCard({ data }: { data: Rec }) {
  const rowsKey = ROW_KEYS.find((key) => Array.isArray(data[key]));
  // Other arrays of flat objects (frankfurter/history's summary) get their own small table.
  const extras = Object.entries(data).filter(
    ([key, value]) => key !== rowsKey && Array.isArray(value) && value.length > 0 && value.every(isFlatRecord),
  );
  const skip = new Set([rowsKey ?? "", ...extras.map(([key]) => key)]);
  return (
    <div>
      <Summary data={data} skip={skip} />
      {extras.map(([key, value]) => (
        <div key={key} className="mb-3">
          <DataTable rows={records(value)} />
        </div>
      ))}
      {rowsKey ? <DataTable rows={records(data[rowsKey])} /> : !extras.length && <ObjectFields data={data} />}
      {Object.entries(data)
        .filter(([key, value]) => key !== rowsKey && isRecord(value) && isFlatRecord(value))
        .map(([key, value]) => (
          <Section key={key} label={humanize(key)}>
            <ObjectFields data={value as Rec} />
          </Section>
        ))}
    </div>
  );
}
