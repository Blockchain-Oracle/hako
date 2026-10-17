/**
 * Exact amounts: atomic units (bigint) ↔ canonical decimal strings ("1.25"). Never floating point, so a quote, a
 * proposal and a receipt agree to the last unit.
 */

const TEN = 10n;
const ZERO = 0n;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const ATOMIC_PATTERN = /^\d+$/;

export type AmountErrorReason = "empty" | "invalid" | "negative" | "too_many_decimals";

export class AmountError extends Error {
  constructor(
    readonly input: string,
    readonly reason: AmountErrorReason,
  ) {
    super(`Cannot read "${input}" as an amount (${reason}).`);
    this.name = "AmountError";
  }
}

/** 10^decimals as a bigint. */
export function unitScale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new RangeError(`decimals must be a non-negative integer (got ${decimals})`);
  return TEN ** BigInt(decimals);
}

/**
 * A canonical decimal string ("1.5", "0.000001") to atomic units at `decimals`. Rejects more fractional digits than the
 * token has instead of rounding, and rejects negatives, grouping marks and exponents.
 */
export function toAtomic(decimal: string, decimals: number): bigint {
  const trimmed = decimal.trim();
  if (trimmed === "") throw new AmountError(decimal, "empty");
  if (trimmed.startsWith("-")) throw new AmountError(decimal, "negative");
  if (!DECIMAL_PATTERN.test(trimmed)) throw new AmountError(decimal, "invalid");
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new AmountError(decimal, "too_many_decimals");
  return BigInt(whole) * unitScale(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Atomic units to the canonical decimal string, trailing zeros dropped ("1.5", "0", "-0.25"). */
export function fromAtomic(atomic: bigint, decimals: number): string {
  const negative = atomic < ZERO;
  const abs = negative ? -atomic : atomic;
  const scale = unitScale(decimals);
  const whole = abs / scale;
  const fraction = decimals > 0 ? (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** An atomic amount as APIs send it (a base-10 integer string, e.g. LI.FI's `fromAmount`) to a bigint. */
export function parseAtomic(value: string): bigint {
  const trimmed = value.trim();
  if (trimmed === "") throw new AmountError(value, "empty");
  if (trimmed.startsWith("-")) throw new AmountError(value, "negative");
  if (!ATOMIC_PATTERN.test(trimmed)) throw new AmountError(value, "invalid");
  return BigInt(trimmed);
}

/** Change decimal scale (e.g. 18 → 6). Truncates toward zero when narrowing. */
export function rescaleAtomic(atomic: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return atomic;
  return fromDecimals > toDecimals
    ? atomic / unitScale(fromDecimals - toDecimals)
    : atomic * unitScale(toDecimals - fromDecimals);
}
