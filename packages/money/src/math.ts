/**
 * Fee and minimum-received math in atomic units (bigint). Basis points: 1 bp = 0.01 %, 10,000 bp = 100 %.
 * Every division floors, so a minimum is never overstated and a fee is never understated by more than one unit.
 */

export const BPS_DENOMINATOR = 10_000n;
const ZERO = 0n;
const ONE = 1n;

function assertBps(bps: bigint): void {
  if (bps < ZERO || bps > BPS_DENOMINATOR) throw new RangeError(`basis points must be within 0..${BPS_DENOMINATOR} (got ${bps})`);
}

/** floor(a × b ÷ c) for non-negative inputs. */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c === ZERO) throw new RangeError("division by zero");
  return (a * b) / c;
}

/** ceil(a × b ÷ c) for non-negative inputs. */
export function mulDivUp(a: bigint, b: bigint, c: bigint): bigint {
  if (c === ZERO) throw new RangeError("division by zero");
  const product = a * b;
  return product === ZERO ? ZERO : (product - ONE) / c + ONE;
}

/** A fee of `bps` on `amount`, rounded up (the payer never sees a fee smaller than the one charged). */
export function feeFromBps(amount: bigint, bps: bigint): bigint {
  assertBps(bps);
  return mulDivUp(amount, bps, BPS_DENOMINATOR);
}

/** The least the user receives on `toAmount` with `slippageBps` of tolerance, rounded down. */
export function minReceived(toAmount: bigint, slippageBps: bigint): bigint {
  assertBps(slippageBps);
  return mulDiv(toAmount, BPS_DENOMINATOR - slippageBps, BPS_DENOMINATOR);
}

/** How far `actual` fell below `expected`, in basis points (0 when it didn't), rounded up. */
export function shortfallBps(expected: bigint, actual: bigint): bigint {
  if (expected <= ZERO || actual >= expected) return ZERO;
  return mulDivUp(expected - actual, BPS_DENOMINATOR, expected);
}

export function sumAtomic(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, ZERO);
}

/** What is left of `amount` after `fees` (never below zero). */
export function netAfterFees(amount: bigint, fees: readonly bigint[]): bigint {
  const net = amount - sumAtomic(fees);
  return net < ZERO ? ZERO : net;
}

/** EIP-1559 fee cap: `multiplier` × the latest base fee + the priority fee (plan B13 `/v1/broadcast`). */
export function maxFeePerGas(baseFeePerGas: bigint, maxPriorityFeePerGas: bigint, multiplier: bigint): bigint {
  return multiplier * baseFeePerGas + maxPriorityFeePerGas;
}
