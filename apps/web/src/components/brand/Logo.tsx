import { HakoLockup } from "@hako/brand/react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** The Hako lockup (the 箱 mark and the name in Roboto Condensed Black) linking home. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex text-[1.375rem] text-foreground", className)} aria-label="Hako home">
      <HakoLockup />
    </Link>
  );
}
