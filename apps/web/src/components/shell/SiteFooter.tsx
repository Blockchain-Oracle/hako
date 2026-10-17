import { Seal } from "@hako/brand/react";
import Link from "next/link";

import { FOOTER_COLUMNS } from "@/lib/constants/landing";

/** Monid's footer: the dark slab, a short blurb, three link columns, and the giant cropped wordmark. */
export function SiteFooter({ toolCount }: { toolCount: number }) {
  return (
    <footer className="overflow-hidden bg-dark text-white">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 pt-16 pb-10 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-sm space-y-6 text-sm text-on-dark-muted">
          <p>
            Hako connects your agent to {toolCount} tools &amp; APIs. One integration. Your agent discovers and
            compares tools for free, and pays per call in USDC on Base with your PayBox wallet.
          </p>
          <p className="text-xs">© 2026 Hako · Built for the MoonPay PayBox Hackathons, Chapter 1</p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="mb-4 font-mono text-[0.6875rem] tracking-[0.12em] text-on-dark-muted uppercase">
              {column.title}
            </p>
            <ul className="space-y-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith("/") ? (
                    <Link href={link.href} className="text-white/90 transition-colors hover:text-white">
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} className="text-white/90 transition-colors hover:text-white">
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div
        className="mx-auto flex max-w-[1400px] translate-y-[22%] items-center justify-center gap-[0.04em] px-4 font-display text-[clamp(6rem,24vw,22rem)] leading-none font-semibold tracking-[-0.05em] text-white select-none"
        aria-hidden
      >
        <span>Hako</span>
        <Seal className="size-[0.8em]" label={null} />
      </div>
    </footer>
  );
}
