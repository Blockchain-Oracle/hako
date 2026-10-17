"use client";

import { ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";

import { cn } from "@/lib/utils";

import { LIST_PREVIEW } from "../constants";
import { formatAbsolute, formatAmount, formatRate, humanize } from "../format";
import { num, pickNum, pickRecords, pickStr, type Rec, rec, records, rowKey, str } from "../parse";
import { Empty, Meta, Pill, ShowAll, usePreview } from "../primitives";
import { AgreementPill, FreshnessPill } from "./Provenance";

// Quote, rate, date and sources; the fixings row spans them (one more when "converted" is shown).
const TABLE_COLUMNS = 4;

interface Rate {
  base: string | null;
  quote: string;
  rate: number;
  date: string | null;
  amount: number | null;
  converted: number | null;
  providers: Rec[];
  provenance: Rec;
}

function readRate(o: Rec, fallback: Rec): Rate | null {
  const quote = pickStr(o, "quote", "to", "currency", "symbol");
  const rate = pickNum(o, "rate", "value");
  if (!quote || rate === null) return null;
  return {
    base: pickStr(o, "base", "from") ?? pickStr(fallback, "base", "from"),
    quote,
    rate,
    date: pickStr(o, "date", "as_of") ?? pickStr(fallback, "date"),
    amount: pickNum(o, "amount") ?? pickNum(fallback, "amount"),
    converted: pickNum(o, "converted", "result"),
    providers: records(o.providers),
    provenance: rec(o.provenance),
  };
}

/** hako/fx and frankfurter/rates send rates[]; frankfurter/convert sends one flat pair. */
function readRates(data: Rec): Rate[] {
  const listed = pickRecords(data, "rates", "results", "items");
  const rows = listed.length > 0 ? listed : [data];
  return rows.map((row) => readRate(row, data)).filter((r): r is Rate => r !== null);
}

function Fixings({ providers }: { providers: Rec[] }) {
  return (
    <ul className="space-y-1 py-1">
      {providers.map((p, i) => (
        <li key={rowKey(p, i, "provider")} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span className="font-medium text-foreground">{pickStr(p, "name", "provider") ?? "Publisher"}</span>
          {num(p.rate) !== null && <span className="font-mono text-muted-foreground">{formatRate(num(p.rate) ?? 0)}</span>}
          <Meta className="text-[0.6875rem]">
            {str(p.date) && formatAbsolute(p.date)}
            {str(p.rate_type)}
            {str(p.cadence)}
            {num(p.business_days_old) !== null && `${num(p.business_days_old)} business ${num(p.business_days_old) === 1 ? "day" : "days"} old`}
            {p.issuer === true && <Pill tone="brand">Issuer</Pill>}
          </Meta>
        </li>
      ))}
    </ul>
  );
}

function RateRow({ rate, showConverted, showSources }: { rate: Rate; showConverted: boolean; showSources: boolean }) {
  const [open, setOpen] = useState(false);
  const expandable = rate.providers.length > 0;
  const inverse = rate.rate !== 0 ? `1 ${rate.quote} = ${formatRate(1 / rate.rate)} ${rate.base ?? ""}` : undefined;
  return (
    <Fragment>
      <tr className="border-b border-border last:border-0">
        <td className="px-2.5 py-1.5 font-mono font-semibold text-foreground">{rate.quote}</td>
        <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-foreground" title={inverse}>
          {formatRate(rate.rate)}
        </td>
        {showConverted && (
          <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap tabular-nums text-muted-foreground">
            {rate.converted !== null ? formatAmount(rate.converted, rate.quote) : "—"}
          </td>
        )}
        <td className="px-2.5 py-1.5 whitespace-nowrap text-muted-foreground">{rate.date ? formatAbsolute(rate.date) : "—"}</td>
        {showSources && (
          <td className="px-2.5 py-1.5 text-right">
            <span className="inline-flex items-center gap-1.5">
              <FreshnessPill provenance={rate.provenance} />
              <AgreementPill provenance={rate.provenance} />
              {expandable && (
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} each publisher's ${rate.quote} fixing`}
                  className="inline-flex items-center gap-0.5 text-xs text-link hover:underline"
                >
                  {rate.providers.length}
                  <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />
                </button>
              )}
            </span>
          </td>
        )}
      </tr>
      {open && (
        <tr className="border-b border-border bg-card">
          <td colSpan={TABLE_COLUMNS + (showConverted ? 1 : 0)} className="px-2.5 py-1.5">
            <Fixings providers={rate.providers} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Currency rates (hako/fx, frankfurter/rates, frankfurter/convert): base → quotes, conversion, agreement. */
export function FxCard({ data }: { data: Rec }) {
  const rates = readRates(data);
  const { shown, expanded, toggle, total } = usePreview(rates, LIST_PREVIEW);
  if (rates.length === 0) return <Empty>No rates.</Empty>;
  const base = pickStr(data, "base", "from") ?? rates[0]?.base ?? null;
  const amount = pickNum(data, "amount") ?? rates[0]?.amount ?? null;
  const showConverted = amount !== null && rates.some((r) => r.converted !== null);
  const showSources = rates.some((r) => r.providers.length > 0 || str(r.provenance.agreement) !== null);
  const single = rates.length === 1 ? rates[0] : undefined;
  const provider = str(data.provider);
  return (
    <div>
      {single && (
        <div className="mb-3">
          {amount !== null && single.converted !== null ? (
            <p className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
              {formatAmount(amount, base)} <span className="text-muted-foreground">=</span> {formatAmount(single.converted, single.quote)}
            </p>
          ) : (
            <p className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">
              1 {base} = {formatRate(single.rate)} {single.quote}
            </p>
          )}
          <Meta className="mt-1">
            {amount !== null && single.converted !== null && `1 ${base} = ${formatRate(single.rate)} ${single.quote}`}
            {single.date && `rate of ${formatAbsolute(single.date)}`}
            {provider && `via ${humanize(provider)}`}
          </Meta>
        </div>
      )}
      {!single && (
        <p className="mb-3 text-[0.8125rem] text-muted-foreground">
          {amount !== null ? `${formatAmount(amount, base)} in` : `1 ${base ?? "unit"} in`} {rates.length} currencies
          {provider && ` · via ${humanize(provider)}`}
        </p>
      )}
      {(!single || single.providers.length > 0 || str(single.provenance.agreement)) && (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full border-collapse text-left text-[0.8125rem]">
            <thead>
              <tr className="border-b border-border bg-card font-mono text-[0.625rem] tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase">
                <th scope="col" className="px-2.5 py-1.5 font-normal">{base ? `${base} →` : "Quote"}</th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-normal">Rate</th>
                {showConverted && <th scope="col" className="px-2.5 py-1.5 text-right font-normal">Converted</th>}
                <th scope="col" className="px-2.5 py-1.5 font-normal">Date</th>
                {showSources && <th scope="col" className="px-2.5 py-1.5 text-right font-normal">Sources</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((rate, index) => (
                <RateRow key={`${rate.quote}-${index}`} rate={rate} showConverted={showConverted} showSources={showSources} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ShowAll total={total} limit={LIST_PREVIEW} expanded={expanded} onToggle={toggle} noun="rates" />
    </div>
  );
}
