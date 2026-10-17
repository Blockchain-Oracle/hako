"use client";

// Source: 21st.dev barvian/number-flow (id 1444), the `@number-flow/react` component. Kawase's use: every live figure on
// the web (balance hero, prices, run totals) rolls its changed digits instead of swapping the text, the web twin of the
// phone's Skia odometer. NumberFlow respects `prefers-reduced-motion` itself (the digits swap), and it is accessible
// (the full value is the element's text for assistive technology). Money figures are tabular and in the display face
// through the `font-display` and `tabular-nums` classes; colours come from the caller's token classes.

import NumberFlow, { type Format, type Value } from "@number-flow/react";

import { cn } from "@hako/ui/lib/utils";

export type OdometerProps = {
  value: Value;
  /** Intl.NumberFormat options: `{ style: "currency", currency: "USD" }`, `{ maximumFractionDigits: 2 }`. */
  format?: Format;
  locales?: string | string[];
  prefix?: string;
  suffix?: string;
  /** `0` rolls every changed digit the same way; `undefined` follows the direction of the change (up on a rise). */
  trend?: number;
  /**
   * A live price that ticks several times a second: a quick roll, so each one finishes before the next (at NumberFlow's
   * default 0.9 s the last digits were always mid-roll and showed two at once).
   */
  live?: boolean;
  className?: string;
};

const LIVE_ROLL = { duration: 400, easing: "cubic-bezier(0.2, 0, 0, 1)" } as const;
const LIVE_FADE = { duration: 200, easing: "ease-out" } as const;

export function Odometer({ value, format, locales, prefix, suffix, trend, live = false, className }: OdometerProps) {
  return (
    <NumberFlow
      value={value}
      {...(live ? { spinTiming: LIVE_ROLL, transformTiming: LIVE_ROLL, opacityTiming: LIVE_FADE } : {})}
      {...(format ? { format } : {})}
      {...(locales ? { locales } : {})}
      {...(prefix ? { prefix } : {})}
      {...(suffix ? { suffix } : {})}
      {...(trend !== undefined ? { trend } : {})}
      className={cn("tabular-nums", className)}
    />
  );
}

export default Odometer;
