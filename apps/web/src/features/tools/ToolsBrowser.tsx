"use client";

import { LayoutGrid, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ProviderLogo } from "@/components/common/ProviderLogo";
import type { Catalog } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

const ALL = "all";

/** Monid's catalog page: a search bar, a category rail on the left, provider cards on the right. */
export function ToolsBrowser({ catalog }: { catalog: Catalog }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);

  const providers = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return catalog.providers
      .filter((p) => p.available)
      .filter((p) => {
        const endpoints = catalog.endpoints.filter((e) => e.provider === p.id);
        if (category !== ALL && !endpoints.some((e) => e.categories.includes(category))) return false;
        const haystack = [p.displayName, p.summary, ...endpoints.flatMap((e) => [e.displayName, e.summary, e.id])]
          .join(" ")
          .toLowerCase();
        return words.every((w) => haystack.includes(w));
      });
  }, [catalog, query, category]);

  return (
    <div className="mt-10">
      <label className="flex h-12 items-center gap-3 rounded-md border border-line bg-background px-4 shadow-card focus-within:border-brand">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the catalog — try 'papers', 'weather' or 'npm'"
          className="h-full flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground"
          aria-label="Search the catalog"
        />
      </label>
      <div className="mt-8 grid gap-8 md:grid-cols-[220px_1fr]">
        <nav aria-label="Categories" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {[{ id: ALL, label: "All", endpointCount: catalog.endpoints.length }, ...catalog.categories].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-[0.9375rem] transition-colors",
                category === c.id ? "bg-muted font-medium text-foreground" : "text-ink-2 hover:bg-subtle",
              )}
            >
              {c.id === ALL && <LayoutGrid className="size-4" aria-hidden />}
              <span className="flex-1">{c.label}</span>
              <span className="hidden font-mono text-[0.6875rem] text-muted-foreground md:inline">{c.endpointCount}</span>
            </button>
          ))}
        </nav>
        <ul className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <li key={p.id}>
              <Link
                href={`/tools/${p.id}`}
                className="flex h-full flex-col rounded-md border border-line bg-background p-5 shadow-card transition-shadow hover:shadow-card-hover"
              >
                <span className="flex items-center gap-3">
                  <ProviderLogo id={p.id} name={p.displayName} />
                  <span className="font-semibold">{p.displayName}</span>
                </span>
                <span className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.summary}</span>
                <span className="mt-auto pt-4 font-mono text-[0.6875rem] text-muted-foreground">
                  {p.endpointCount} endpoint{p.endpointCount === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
          {providers.length === 0 && (
            <li className="col-span-full rounded-md border border-dashed border-line-default p-10 text-center text-muted-foreground">
              No tool matches. Your agent can still ask: <code className="font-mono">POST /v1/discover</code>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
