"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { LIST_PREVIEW, MONEY_DECIMALS } from "../constants";
import { formatCount, formatMoney, formatNumber, formatPercent, formatSigned } from "../format";
import { pickNum, pickRecords, pickStr, type Rec, rec, rowKey, str } from "../parse";
import { Empty, Meta, ShowAll, Stat, TimeAgo, usePreview } from "../primitives";
import { AgreementPill } from "./Provenance";

const PRICE_KEYS = ["price", "last", "regular_market_price", "close", "value"];

function Change({ quote }: { quote: Rec }) {
  const change = pickNum(quote, "change", "change_abs", "regular_market_change");
  const pct = pickNum(quote, "change_pct", "change_percent", "percent_change", "regular_market_change_percent");
  if (change === null && pct === null) return null;
  const up = (pct ?? change ?? 0) >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-mono text-[0.8125rem]", up ? "text-success" : "text-ink-2")}>
      <Icon className="size-3.5" aria-hidden />
      {change !== null && formatSigned(change, MONEY_DECIMALS)}
      {pct !== null && <span>({formatPercent(pct)})</span>}
    </span>
  );
}

function Quote({ quote, large }: { quote: Rec; large: boolean }) {
  const symbol = pickStr(quote, "symbol", "ticker", "id");
  const name = pickStr(quote, "name", "short_name", "long_name", "title");
  const price = pickNum(quote, ...PRICE_KEYS);
  const currency = pickStr(quote, "currency", "currency_code");
  const asOf = quote.as_of ?? quote.time ?? quote.timestamp ?? quote.updated_at;
  const volume = pickNum(quote, "volume");
  const cap = pickNum(quote, "market_cap");
  const stats: Array<[string, number | null]> = [
    ["Open", pickNum(quote, "open")],
    ["High", pickNum(quote, "high", "day_high")],
    ["Low", pickNum(quote, "low", "day_low")],
    ["Prev close", pickNum(quote, "prev_close", "previous_close")],
  ];
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-mono text-[0.9375rem] font-semibold text-foreground">{symbol ?? name ?? "Quote"}</p>
          {symbol && name && <p className="truncate text-xs text-muted-foreground">{name}</p>}
        </div>
        <div className="text-right">
          <p className={cn("font-mono font-semibold text-foreground", large ? "text-2xl" : "text-base")}>
            {price !== null ? formatMoney(price, currency) : "—"}
          </p>
          <Change quote={quote} />
        </div>
      </div>
      {large && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <Stat key={label} label={label} value={value !== null ? formatNumber(value, MONEY_DECIMALS) : null} />
          ))}
        </div>
      )}
      <Meta className="mt-1.5">
        {pickStr(quote, "exchange", "market")}
        {str(quote.market_state)}
        {volume !== null && `vol ${formatCount(volume)}`}
        {cap !== null && `cap ${formatCount(cap)}`}
        {str(asOf) && <TimeAgo value={asOf} />}
        {str(rec(quote.provenance).agreement) && <AgreementPill provenance={rec(quote.provenance)} />}
      </Meta>
    </li>
  );
}

/** Market quotes: symbol, price, change, currency, as of. */
export function QuoteCard({ data }: { data: Rec }) {
  const listed = pickRecords(data, "quotes", "results", "rows", "items");
  const quotes = listed.length > 0 ? listed : pickNum(data, ...PRICE_KEYS) !== null ? [data] : [];
  const { shown, expanded, toggle, total } = usePreview(quotes, LIST_PREVIEW);
  if (quotes.length === 0) return <Empty>No quotes.</Empty>;
  return (
    <div>
      <ol className="divide-y divide-line">
        {shown.map((quote, index) => (
          <Quote key={rowKey(quote, index, "symbol")} quote={quote} large={quotes.length === 1} />
        ))}
      </ol>
      <ShowAll total={total} limit={LIST_PREVIEW} expanded={expanded} onToggle={toggle} noun="quotes" />
    </div>
  );
}
