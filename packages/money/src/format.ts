import { unitScale } from "./atomic.js";

/**
 * Display formatting for exact amounts. Numbers go to `Intl.NumberFormat` as decimal strings (exact, ES2023 "string"
 * overload), never as floats. Output is tabular-friendly: a fixed number of fraction digits unless asked to trim, and
 * signed values use U+2212 MINUS SIGN, which has the width of "+" in tabular figures (a hyphen doesn't).
 */

export const DEFAULT_LOCALE = "en-US";
/** Fraction digits a token amount shows unless the caller asks otherwise ("1,234.50 USDC"). */
export const DEFAULT_FRACTION_DIGITS = 2;
export const MINUS_SIGN = "−";
export const PLUS_SIGN = "+";

const ZERO = 0n;

export interface AmountFormatOptions {
  locale?: string;
  /** Fraction digits to show (never more than the token has). Extra digits are cut, never rounded up. */
  fractionDigits?: number;
  /** Drop trailing zeros ("63.5" instead of "63.50"). */
  trimZeros?: boolean;
  /** "never" (default): no sign on positives, MINUS SIGN on negatives; "always": also "+" on positives (deltas). */
  signDisplay?: "never" | "always";
}

type IntlStringFormat = (value: string) => string;

function formatDecimalString(decimal: string, locale: string, minFraction: number, maxFraction: number): string {
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: minFraction, maximumFractionDigits: maxFraction });
  return (formatter.format as unknown as IntlStringFormat)(decimal);
}

function signPrefix(negative: boolean, isZero: boolean, signDisplay: AmountFormatOptions["signDisplay"]): string {
  if (negative) return MINUS_SIGN;
  return signDisplay === "always" && !isZero ? PLUS_SIGN : "";
}

/** The number part of an atomic amount, localized: "1,234.50", "−0.25". */
export function formatAtomic(atomic: bigint, decimals: number, options: AmountFormatOptions = {}): string {
  const fractionDigits = Math.min(options.fractionDigits ?? DEFAULT_FRACTION_DIGITS, decimals);
  const negative = atomic < ZERO;
  const abs = negative ? -atomic : atomic;
  const scale = unitScale(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, "0").slice(0, fractionDigits);
  const decimal = fractionDigits > 0 ? `${whole}.${fraction}` : `${whole}`;
  const number = formatDecimalString(decimal, options.locale ?? DEFAULT_LOCALE, options.trimZeros ? 0 : fractionDigits, fractionDigits);
  return `${signPrefix(negative, abs === ZERO, options.signDisplay)}${number}`;
}

/** A token amount with its symbol: "1,234.50 USDC". */
export function formatTokenAmount(atomic: bigint, decimals: number, symbol: string, options: AmountFormatOptions = {}): string {
  return `${formatAtomic(atomic, decimals, options)} ${symbol}`;
}

/**
 * A price that can be a fraction of a cent (x402 tools cost $0.001–$0.10): every significant digit, at least the
 * default two. "0.001 USDC", "0.10 USDC", "1.25 USDC".
 */
export function formatPrice(atomic: bigint, decimals: number, symbol: string, options: Pick<AmountFormatOptions, "locale"> = {}): string {
  const abs = atomic < ZERO ? -atomic : atomic;
  const fraction = (abs % unitScale(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  const fractionDigits = Math.max(fraction.length, DEFAULT_FRACTION_DIGITS);
  return formatTokenAmount(atomic, decimals, symbol, { ...options, fractionDigits });
}

/** A US-dollar value from a canonical decimal string ("1234.5" → "$1,234.50"). */
export function formatUsd(decimal: string, options: Pick<AmountFormatOptions, "locale" | "fractionDigits" | "signDisplay"> = {}): string {
  const trimmed = decimal.trim();
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;
  const fractionDigits = options.fractionDigits ?? DEFAULT_FRACTION_DIGITS;
  const formatter = new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const isZero = /^0*\.?0*$/.test(abs);
  return `${signPrefix(negative && !isZero, isZero, options.signDisplay)}${(formatter.format as unknown as IntlStringFormat)(abs)}`;
}
