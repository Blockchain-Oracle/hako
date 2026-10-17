"use client";

import { ArrowRight, CalendarDays, Clock } from "lucide-react";

import { LIST_PREVIEW, MS_PER_SECOND, SECONDS_PER_DAY } from "../constants";
import { formatDay, wallClock } from "../format";
import { num, pickRecords, pickStr, type Rec, rec, records, rowKey, str, strings } from "../parse";
import { Empty, Label, Meta, Pill, Section, ShowAll, TimeAgo, usePreview } from "../primitives";
import { useNow } from "../useNow";
import { DataTable, ObjectFields } from "./TableCard";

const DATE_PART_LENGTH = "YYYY-MM-DD".length;
const YEAR_LENGTH = "YYYY".length;

function zoneLabel(zone: string | null): string | null {
  return zone ? zone.replaceAll("_", " ") : null;
}

function Clockface({ data }: { data: Rec }) {
  const local = pickStr(data, "local_time", "time", "datetime");
  const zone = zoneLabel(pickStr(data, "zone", "timezone"));
  const transition = rec(data.next_transition);
  const conversions = records(data.conversions);
  const day = local?.slice(0, DATE_PART_LENGTH);
  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="font-display text-5xl leading-none font-semibold tracking-[-0.04em] text-foreground">{wallClock(local) ?? local ?? "—"}</p>
        <div className="pb-0.5">
          <p className="text-[0.9375rem] font-medium text-foreground">{zone ?? "Local time"}</p>
          <Meta>
            {formatDay(local)}
            {str(data.abbreviation) && <span className="font-mono">{str(data.abbreviation)}</span>}
            {str(data.utc_offset) && <span className="font-mono">UTC{str(data.utc_offset)}</span>}
            {data.is_dst === true && <Pill tone="brand">DST</Pill>}
          </Meta>
        </div>
      </div>
      {str(data.matched) && <p className="mt-2 text-xs text-muted-foreground">Matched {str(data.matched)}</p>}
      {str(transition.at) && (
        <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          <Clock className="size-3.5" aria-hidden /> Clocks change <TimeAgo value={transition.at} className="font-medium text-foreground" />:
          <span className="font-mono">{str(transition.offset_before)}</span>
          <ArrowRight className="size-3" aria-hidden />
          <span className="font-mono">{str(transition.offset_after)}</span>
        </p>
      )}
      {conversions.length > 0 && (
        <Section label="Same moment elsewhere">
          <ul className="divide-y divide-border">
            {conversions.map((c, index) => {
              const time = pickStr(c, "local_time", "time");
              const otherDay = time?.slice(0, DATE_PART_LENGTH) !== day;
              return (
                <li key={rowKey(c, index, "zone")} className="flex items-baseline justify-between gap-3 py-1.5 text-[0.8125rem]">
                  <span className="min-w-0 truncate text-foreground">{zoneLabel(pickStr(c, "zone", "timezone")) ?? "—"}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    {otherDay && <span className="text-xs text-muted-foreground">{formatDay(time)}</span>}
                    <span className="font-mono text-base font-semibold text-foreground">{wallClock(time) ?? time}</span>
                    <span className="w-24 text-right font-mono text-xs text-muted-foreground">
                      {pickStr(c, "abbreviation") ?? ""} {str(c.utc_offset) ? `UTC${str(c.utc_offset)}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {str(data.tzdb_version) && (
        <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">
          tzdb {str(data.tzdb_version)}
          {str(data.tzdb_latest) && str(data.tzdb_latest) !== str(data.tzdb_version) && ` (${str(data.tzdb_latest)} is out)`}
        </p>
      )}
    </div>
  );
}

function Holidays({ data, holidays }: { data: Rec; holidays: Rec[] }) {
  const now = useNow();
  const today = now ? new Date(now).toISOString().slice(0, DATE_PART_LENGTH) : null;
  const sorted = [...holidays].sort((a, b) => (pickStr(a, "date") ?? "").localeCompare(pickStr(b, "date") ?? ""));
  const next = today ? sorted.find((h) => (pickStr(h, "date") ?? "") >= today) : undefined;
  const { shown, expanded, toggle, total } = usePreview(sorted, LIST_PREVIEW * 2);
  const count = num(data.count) ?? holidays.length;
  const heading = [pickStr(data, "country", "region"), str(data.year), pickStr(data, "calendar")].filter(Boolean).join(" · ");
  return (
    <div>
      <p className="mb-3 text-[0.8125rem] text-muted-foreground">
        {heading && <span className="font-mono text-foreground">{heading}</span>} · {count} {count === 1 ? "holiday" : "holidays"}
      </p>
      <ol className="divide-y divide-border">
        {shown.map((h, index) => {
          const others = strings(h.other_names);
          const provenance = rec(h.provenance);
          const listedBy = strings(h.listed_by);
          return (
            <li key={rowKey(h, index, "date", "name")} className="grid grid-cols-[6.5rem_1fr] gap-3 py-1.5 text-[0.8125rem]">
              <span className="font-mono text-xs text-muted-foreground">{formatDay(h.date) ?? "—"}</span>
              <span className="min-w-0">
                <span className="font-medium text-foreground">{pickStr(h, "name", "local_name") ?? "Holiday"}</span>
                {h === next && <Pill tone="brand" className="ml-2">next</Pill>}
                {h.observed === true && <Pill className="ml-2">observed</Pill>}
                {h.local_only === true && <Pill tone="outline" className="ml-2">regional</Pill>}
                {str(provenance.agreement) === "conflict" && (
                  // A date the calendars disagree on is common (estimated lunar dates): say who lists it, quietly.
                  <Pill tone="outline" className="ml-2" title="The sources disagree on this date">
                    {listedBy.length > 0 ? `only ${listedBy.join(", ")}` : "disputed"}
                  </Pill>
                )}
                {others.length > 0 && <span className="block text-xs text-muted-foreground">also {others.join(", ")}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <ShowAll total={total} limit={LIST_PREVIEW * 2} expanded={expanded} onToggle={toggle} noun="holidays" />
    </div>
  );
}

function BusinessDays({ data }: { data: Rec }) {
  const days = num(data.business_days);
  const skipped = strings(data.holidays_skipped);
  const weekend = strings(data.weekend);
  const start = str(data.start);
  const end = str(data.end);
  const span = start && end ? (Date.parse(end) - Date.parse(start)) / MS_PER_SECOND / SECONDS_PER_DAY : null;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="font-display text-5xl leading-none font-semibold tracking-[-0.04em] text-foreground">{days ?? "—"}</p>
        <p className="pb-1 text-[0.9375rem] font-medium text-foreground">business {days === 1 ? "day" : "days"}</p>
      </div>
      <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
        <CalendarDays className="size-3.5" aria-hidden />
        {formatDay(start) ?? "—"} <ArrowRight className="size-3" aria-hidden /> {formatDay(end) ?? "—"}
        {end && <span>{end.slice(0, YEAR_LENGTH)}</span>}
        {span !== null && Number.isFinite(span) && <span className="text-muted-foreground">({span} calendar days)</span>}
      </p>
      <Meta className="mt-1">
        {str(data.calendar) && <span className="font-mono">{str(data.calendar)} calendar</span>}
        {weekend.length > 0 && `weekend ${weekend.join(" + ")}`}
      </Meta>
      {skipped.length > 0 && (
        <Section label="Holidays skipped">
          <ul className="space-y-0.5 text-[0.8125rem] text-muted-foreground">
            {skipped.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Clocks and calendars: hako/time, hako/holidays, hako/business-days. */
export function TimeCard({ data }: { data: Rec }) {
  const holidays = pickRecords(data, "holidays");
  if (Array.isArray(data.holidays)) return holidays.length ? <Holidays data={data} holidays={holidays} /> : <Empty>No holidays listed.</Empty>;
  if (num(data.business_days) !== null) return <BusinessDays data={data} />;
  if (pickStr(data, "local_time", "zone", "timezone")) return <Clockface data={data} />;
  const rows = pickRecords(data, "rows", "items");
  if (rows.length > 0) return <DataTable rows={rows} />;
  return (
    <div>
      <Label className="mb-2">Details</Label>
      <ObjectFields data={data} />
    </div>
  );
}
