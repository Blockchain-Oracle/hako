import { Seal } from "@hako/brand/react";
import Link from "next/link";

import { ProviderLogo } from "@/components/common/ProviderLogo";
import { HERO_GRID_COLUMNS, HERO_PROVIDER_ORDER, HERO_TILE_COUNT } from "@/lib/constants/landing";
import type { Catalog } from "@/lib/catalog/types";

const LINE_VIEWBOX_WIDTH = 1000;
const LINE_VIEWBOX_HEIGHT = 120;
const HUB_X = LINE_VIEWBOX_WIDTH / 2;
const COLUMN_STEP = LINE_VIEWBOX_WIDTH / HERO_GRID_COLUMNS;

/** The centre mark, a dark name pill, and lines fanning out to a grid of provider tiles (Monid's "orbit"). */
export function ToolHub({ catalog }: { catalog: Catalog }) {
  const labels = new Map(catalog.categories.map((c) => [c.id, c.label]));
  const rank = (id: string) => {
    const index = (HERO_PROVIDER_ORDER as readonly string[]).indexOf(id);
    return index === -1 ? HERO_PROVIDER_ORDER.length : index;
  };
  const tiles = catalog.providers
    .filter((p) => p.available)
    .sort((a, b) => rank(a.id) - rank(b.id) || a.displayName.localeCompare(b.displayName))
    .slice(0, HERO_TILE_COUNT);
  const total = catalog.endpoints.filter((e) => e.available).length;
  const columnCenters = Array.from({ length: HERO_GRID_COLUMNS }, (_, i) => COLUMN_STEP * i + COLUMN_STEP / 2);
  return (
    <div className="relative mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
      <div className="flex flex-col items-center pt-14">
        <Seal className="size-16 text-brand" label="Hako" />
        <span className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-dark px-5 py-2.5 font-display text-[0.95rem] font-semibold text-white shadow-pill">
          Hako <Seal className="size-[1.05em]" label={null} />
        </span>
      </div>
      <svg
        viewBox={`0 0 ${LINE_VIEWBOX_WIDTH} ${LINE_VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        className="hub-lines hidden h-[120px] w-full md:block"
        aria-hidden
      >
        {columnCenters.map((x) => (
          <path key={x} d={`M${HUB_X} 0 C ${HUB_X} ${LINE_VIEWBOX_HEIGHT / 2}, ${x} ${LINE_VIEWBOX_HEIGHT / 2}, ${x} ${LINE_VIEWBOX_HEIGHT}`} />
        ))}
      </svg>
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:mt-0 md:grid-cols-5">
        {tiles.map((p) => (
          <li key={p.id}>
            <Link
              href={`/tools/${p.id}`}
              className="flex h-full items-center gap-3 rounded-md border border-line bg-background px-4 py-3.5 text-left shadow-card transition-shadow hover:shadow-card-hover"
            >
              <ProviderLogo id={p.id} name={p.displayName} />
              <span className="min-w-0">
                <span className="block truncate text-[0.9375rem] font-medium text-foreground">{p.displayName}</span>
                <span className="block truncate font-mono text-[0.6875rem] text-muted-foreground">
                  {(labels.get(p.categories[0] ?? "") ?? p.categories[0] ?? "").toLowerCase()}
                </span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/tools"
            className="flex h-full min-h-[64px] items-center justify-center rounded-md bg-brand px-4 py-3.5 text-[0.9375rem] font-medium text-primary-foreground transition-colors hover:bg-brand-hover"
          >
            See all {total} tools
          </Link>
        </li>
      </ul>
    </div>
  );
}
