import { Seal } from "@hako/brand/react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** "Hako" in Outfit with the 証 seal where Monid has its asterisk; both in the accent. */
export function Logo({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-1.5 font-display text-[1.375rem] font-semibold tracking-[-0.03em]",
        inverse ? "text-white" : "text-brand",
        className,
      )}
      aria-label="Hako home"
    >
      <span>Hako</span>
      <Seal className="size-[1.15em] translate-y-[-0.02em]" label={null} />
    </Link>
  );
}
