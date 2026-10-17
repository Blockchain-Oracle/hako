"use client";

import { useState } from "react";

import { ProviderLogo } from "@/components/common/ProviderLogo";
import { formatPrice } from "@/lib/catalog/format";
import type { CatalogEndpoint } from "@/lib/catalog/types";

import { EndpointDialog } from "./EndpointDialog";

/** Monid's endpoint cards: provider line, title + badge, path, summary, price; a click opens the detail dialog. */
export function EndpointGrid({ endpoints }: { endpoints: CatalogEndpoint[] }) {
  const [open, setOpen] = useState<CatalogEndpoint | null>(null);
  return (
    <>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {endpoints.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => setOpen(e)}
              className="flex h-full w-full flex-col rounded-md border border-line bg-background p-5 text-left shadow-card transition-shadow hover:shadow-card-hover"
            >
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <ProviderLogo id={e.provider} name={e.providerName} size="sm" /> {e.providerName}
              </span>
              <span className="mt-3 flex items-start justify-between gap-3">
                <span className="font-semibold">{e.displayName}</span>
                <span className="shrink-0 rounded-sm bg-brand/[0.07] px-1.5 py-0.5 font-mono text-[0.625rem] tracking-[0.08em] text-brand uppercase">
                  {e.available ? "Live" : "Off"}
                </span>
              </span>
              <span className="mt-1 font-mono text-xs text-muted-foreground">/{e.slug}</span>
              <span className="mt-3 line-clamp-3 text-sm text-ink-2">{e.summary}</span>
              <span className="mt-auto pt-5">
                <span className="block font-mono text-[0.9375rem] font-semibold">{formatPrice(e.price.usd)}</span>
                <span className="font-mono text-[0.6875rem] text-muted-foreground">per call</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <EndpointDialog endpoint={open} onClose={() => setOpen(null)} />
    </>
  );
}
