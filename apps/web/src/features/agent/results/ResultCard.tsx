"use client";

import { SearchX } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { ProviderLogo } from "@/components/common/ProviderLogo";

import { CardBoundary } from "./Boundary";
import { SOURCES_PREVIEW } from "./constants";
import { type Envelope, readEnvelope, type SourceRef } from "./envelope";
import { formatElapsed, humanize, parseDate } from "./format";
import { AnswerCard } from "./kinds/AnswerCard";
import { DefinitionCard } from "./kinds/DefinitionCard";
import { FxCard } from "./kinds/FxCard";
import { JobsCard } from "./kinds/JobsCard";
import { JsonCard } from "./kinds/JsonCard";
import { NewsCard } from "./kinds/NewsCard";
import { PackageCard } from "./kinds/PackageCard";
import { PageCard } from "./kinds/PageCard";
import { PapersCard } from "./kinds/PapersCard";
import { PlaceCard } from "./kinds/PlaceCard";
import { QuoteCard } from "./kinds/QuoteCard";
import { SearchResultsCard } from "./kinds/SearchResultsCard";
import { TableCard } from "./kinds/TableCard";
import { TimeCard } from "./kinds/TimeCard";
import { WeatherCard } from "./kinds/WeatherCard";
import { hostOf, isRecord, type Rec, str } from "./parse";
import { ExtLink, Label, Pill, ShowAll, TimeAgo, usePreview } from "./primitives";

/** One card per render kind (hako_tools.categories.Render); anything else is drawn as JSON. */
const KINDS: Record<string, ComponentType<{ data: Rec }>> = {
  search_results: SearchResultsCard,
  answer: AnswerCard,
  page: PageCard,
  papers: PapersCard,
  news: NewsCard,
  jobs: JobsCard,
  quote: QuoteCard,
  fx: FxCard,
  weather: WeatherCard,
  place: PlaceCard,
  package: PackageCard,
  definition: DefinitionCard,
  time: TimeCard,
  table: TableCard,
  json: JsonCard,
};

const SOURCE_OK = "ok";

function Shell({ children }: { children: ReactNode }) {
  return <article className="w-full min-w-0 rounded-md border border-border bg-background p-4 sm:p-5">{children}</article>;
}

function Header({ env }: { env: Envelope }) {
  const asOf = parseDate(env.asOf) ? env.asOf : null;
  return (
    <header className="mb-3.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      <ProviderLogo id={env.provider} name={humanize(env.provider)} size="sm" />
      <span className="min-w-0 truncate font-mono text-xs text-foreground">{env.endpoint}</span>
      {env.cached && (
        <Pill tone="brand" title="Served from Hako's cache">
          cached
        </Pill>
      )}
      <span className="ml-auto flex items-center gap-1.5 font-mono text-[0.6875rem] text-muted-foreground">
        {asOf && <TimeAgo value={asOf} />}
        {asOf && env.elapsedMs !== null && <span aria-hidden>·</span>}
        {env.elapsedMs !== null && <span title="How long the tool took">{formatElapsed(env.elapsedMs)}</span>}
      </span>
    </header>
  );
}

function Source({ source }: { source: SourceRef }) {
  const ok = source.status === null || source.status === SOURCE_OK;
  const host = hostOf(source.url);
  const title = [source.attribution, source.licence].filter(Boolean).join(" · ") || undefined;
  return (
    <li className="inline-flex items-baseline gap-1" title={title}>
      {host ? (
        <ExtLink href={source.url} className={ok ? "text-foreground hover:text-link" : "text-muted-foreground"}>
          {source.name}
        </ExtLink>
      ) : (
        <span className={ok ? "text-foreground" : "text-muted-foreground"}>{source.name}</span>
      )}
      {host && <span className="text-muted-foreground">{host}</span>}
      {!ok && source.status && <span className="text-muted-foreground italic">({humanize(source.status).toLowerCase()})</span>}
    </li>
  );
}

function Footer({ env }: { env: Envelope }) {
  const { shown, expanded, toggle, total } = usePreview(env.sources, SOURCES_PREVIEW);
  if (env.sources.length === 0 && env.notes.length === 0) return null;
  return (
    <footer className="mt-4 space-y-2 border-t border-border pt-3">
      {env.sources.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Label className="text-[0.625rem]">Sources</Label>
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {shown.map((source, i) => (
              <Source key={`${source.name}-${i}`} source={source} />
            ))}
          </ul>
          <ShowAll total={total} limit={SOURCES_PREVIEW} expanded={expanded} onToggle={toggle} noun="sources" className="mt-0 text-xs" />
        </div>
      )}
      {env.notes.length > 0 && (
        <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
          {env.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </footer>
  );
}

function NotFound({ env }: { env: Envelope }) {
  const message = isRecord(env.data) ? str(env.data.message) : null;
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-medium text-foreground">Nothing found</p>
        <p className="mt-0.5 text-[0.875rem] break-words text-muted-foreground">{message ?? "The provider had no match for this request."}</p>
        {env.billable === false && <p className="mt-1.5 text-xs text-muted-foreground">Not charged — a lookup that finds nothing settles at zero.</p>}
      </div>
    </div>
  );
}

function Body({ env }: { env: Envelope }) {
  if (!env.found) return <NotFound env={env} />;
  if (!isRecord(env.data)) return <JsonCard data={env.data} />;
  const Kind = KINDS[env.render] ?? JsonCard;
  return (
    <CardBoundary fallback={<JsonCard data={env.data} />}>
      <Kind data={env.data} />
    </CardBoundary>
  );
}

/** A tool run's answer: provider and timing on top, the render kind's card, then sources and notes. */
export function ResultCard({ envelope }: { envelope: unknown }) {
  const env = readEnvelope(envelope);
  if (!env) {
    return (
      <Shell>
        <Label className="mb-2">Result</Label>
        <JsonCard data={envelope ?? null} />
      </Shell>
    );
  }
  return (
    <Shell>
      <Header env={env} />
      <Body env={env} />
      <Footer env={env} />
    </Shell>
  );
}
