import {
  COMPACT_FROM,
  COMPASS_POINTS,
  DEFAULT_DECIMALS,
  ELAPSED_SECONDS_FROM_MS,
  FULL_CIRCLE_DEG,
  JUST_NOW_S,
  MONEY_DECIMALS,
  MS_PER_SECOND,
  PERCENT_DECIMALS,
  RATE_DECIMALS,
  RATE_DECIMALS_BELOW_ONE,
  RELATIVE_MAX_DAYS,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from "./constants";
import { str } from "./parse";

const LOCALE = "en-GB";
const SMART_FOUR_DECIMALS_BELOW = 1_000;

const numberFormats = new Map<number, Intl.NumberFormat>();
function numberFormat(maxFraction: number): Intl.NumberFormat {
  let format = numberFormats.get(maxFraction);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFraction });
    numberFormats.set(maxFraction, format);
  }
  return format;
}
// en-GB writes 9.4m and 78k; the card wants 9.4M and 78K.
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone: "UTC" });
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function formatNumber(n: number, maxFraction = DEFAULT_DECIMALS): string {
  return numberFormat(maxFraction).format(n);
}

/** Table numbers: precision by magnitude, so 0.87679 stays a rate and 9,705,469.12 stays a distance. */
export function formatSmart(n: number): string {
  if (Number.isInteger(n)) return formatNumber(n, 0);
  const abs = Math.abs(n);
  if (abs < 1) return formatNumber(n, RATE_DECIMALS_BELOW_ONE);
  if (abs < SMART_FOUR_DECIMALS_BELOW) return formatNumber(n, RATE_DECIMALS);
  return formatNumber(n, DEFAULT_DECIMALS);
}

/** Counts: 1,234 below ten thousand, 15.5K above. */
export function formatCount(n: number): string {
  return Math.abs(n) >= COMPACT_FROM ? compactFormat.format(n) : numberFormat(0).format(n);
}

export function formatRate(n: number): string {
  return formatNumber(n, Math.abs(n) < 1 ? RATE_DECIMALS_BELOW_ONE : RATE_DECIMALS);
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

/** "$227.52", "£90,000", "₦512,345.12" (a symbol where one is unambiguous enough, else the code). */
export function formatMoney(amount: number, currency: string | null): string {
  if (currency && CURRENCY_CODE.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: Number.isInteger(amount) ? 0 : MONEY_DECIMALS,
        maximumFractionDigits: MONEY_DECIMALS,
      }).format(amount);
    } catch {
      // an unknown code: fall through to "1,234.5 XYZ"
    }
  }
  return formatAmount(amount, currency);
}

/** "1,000 USD": FX reads better with codes than with symbols ($ is a dozen currencies). */
export function formatAmount(amount: number, currency: string | null): string {
  return `${formatNumber(amount, MONEY_DECIMALS)}${currency ? ` ${currency}` : ""}`;
}

/** "+1.23%" / "−0.40%" from a value already in percent. */
export function formatPercent(pct: number, signed = true): string {
  const sign = signed && pct > 0 ? "+" : "";
  return `${sign}${formatNumber(pct, PERCENT_DECIMALS)}%`;
}

export function formatSigned(n: number, maxFraction = DEFAULT_DECIMALS): string {
  return `${n > 0 ? "+" : ""}${formatNumber(n, maxFraction)}`;
}

export function formatElapsed(ms: number): string {
  return ms >= ELAPSED_SECONDS_FROM_MS ? `${formatNumber(ms / MS_PER_SECOND, 1)} s` : `${formatNumber(ms, 0)} ms`;
}

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

export interface ParsedDate {
  date: Date;
  dateOnly: boolean;
}

/** ISO dates and datetimes only; "2 days ago" or "2026-Oct-02 01:49" stay as text (null here). */
export function parseDate(value: unknown): ParsedDate | null {
  const raw = str(value);
  if (!raw) return null;
  if (ISO_DATE_ONLY.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : { date, dateOnly: true };
  }
  if (ISO_DATE_TIME.test(raw)) {
    const iso = HAS_ZONE.test(raw) ? raw.replace(" ", "T") : `${raw.replace(" ", "T")}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false };
  }
  return null;
}

/** "7 Oct 2026, 11:32" (in the viewer's zone), "6 Oct 2026" for a bare date, or the text as given. */
export function formatAbsolute(value: unknown): string | null {
  const parsed = parseDate(value);
  if (!parsed) return str(value);
  return parsed.dateOnly ? dateFormat.format(parsed.date) : dateTimeFormat.format(parsed.date);
}

const DATE_PART = /^(\d{4}-\d{2}-\d{2})/;
const CLOCK_PART = /T(\d{2}:\d{2})/;

/** "Wed 7 Oct" from the date as written: a time stamped in the place's own offset keeps the place's day. */
export function formatDay(value: unknown): string | null {
  const raw = str(value);
  const day = raw ? DATE_PART.exec(raw)?.[1] : undefined;
  const parsed = day ? parseDate(day) : null;
  return parsed ? weekdayFormat.format(parsed.date) : raw;
}

/** "14:00" as written in the stamp (the place's wall clock), not converted to the viewer's zone. */
export function wallClock(value: unknown): string | null {
  const raw = str(value);
  return raw ? (CLOCK_PART.exec(raw)?.[1] ?? null) : null;
}

function unit(n: number, label: string, future: boolean): string {
  return future ? `in ${n} ${label}` : `${n} ${label} ago`;
}

/**
 * "just now", "4 min ago", "in 3 h", "2 d ago"; older than a month, a bare date or no clock yet (`now` = 0, the
 * server render) reads as an absolute date; text that is not ISO comes back as given.
 */
export function formatRelative(value: unknown, now: number): string | null {
  const parsed = parseDate(value);
  if (!parsed) return str(value);
  if (parsed.dateOnly || now === 0) return formatAbsolute(value);
  const deltaS = (parsed.date.getTime() - now) / MS_PER_SECOND;
  const future = deltaS > 0;
  const abs = Math.abs(deltaS);
  if (abs < JUST_NOW_S) return "just now";
  if (abs < SECONDS_PER_HOUR) return unit(Math.round(abs / SECONDS_PER_MINUTE), "min", future);
  if (abs < SECONDS_PER_DAY) return unit(Math.round(abs / SECONDS_PER_HOUR), "h", future);
  const days = Math.round(abs / SECONDS_PER_DAY);
  if (days <= RELATIVE_MAX_DAYS) return unit(days, days === 1 ? "day" : "days", future);
  return formatAbsolute(value);
}

const SEPARATORS = /[_-]+/g;
const CAMEL = /([a-z])([A-Z])/g;

/** "fair_night" → "Fair night", "issueTracker" → "Issue tracker". */
export function humanize(label: string): string {
  const spaced = label.replace(CAMEL, "$1 $2").replace(SEPARATORS, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : label;
}

export function compass(deg: number): string {
  const step = FULL_CIRCLE_DEG / COMPASS_POINTS.length;
  const normalized = ((deg % FULL_CIRCLE_DEG) + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG;
  return COMPASS_POINTS[Math.round(normalized / step) % COMPASS_POINTS.length] ?? "";
}

/** Cut long text for a collapsed view, on a paragraph break when one sits late enough in the budget. */
export function cutText(text: string, budget: number, breakMinShare: number): string {
  if (text.length <= budget) return text;
  const head = text.slice(0, budget);
  const paragraph = head.lastIndexOf("\n\n");
  if (paragraph >= budget * breakMinShare) return head.slice(0, paragraph);
  const space = head.lastIndexOf(" ");
  return `${space >= budget * breakMinShare ? head.slice(0, space) : head}…`;
}
