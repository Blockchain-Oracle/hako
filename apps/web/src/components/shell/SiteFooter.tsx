import { HakoLockup } from "@hako/brand/react";
import Link from "next/link";

import { FOOTER_COLUMNS } from "@/lib/constants/landing";

/** The footer on a quiet card plate (Senryo: depth by fill, no dark slab): a short blurb and three link columns. */
export function SiteFooter({ toolCount }: { toolCount: number }) {
  return (
    <footer className="bg-card text-card-foreground">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 pt-16 pb-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-sm space-y-5 text-sm text-muted-foreground">
          <HakoLockup className="text-2xl text-foreground" />
          <p>
            Hako connects your agent to {toolCount} tools &amp; APIs. One integration. Your agent discovers and
            compares tools for free, and pays per call in USDC on Base with your PayBox wallet.
          </p>
          <p className="text-xs">© 2026 Hako · Built on PayBox · MoonPay, for the MoonPay PayBox Hackathons, Chapter 1</p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="mb-4 text-sm font-semibold text-foreground">{column.title}</p>
            <ul className="space-y-2.5 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith("/") ? (
                    <Link href={link.href} className="text-muted-foreground transition-colors hover:text-foreground">
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} className="text-muted-foreground transition-colors hover:text-foreground">
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}
