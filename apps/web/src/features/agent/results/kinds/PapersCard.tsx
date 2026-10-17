"use client";

import { ABSTRACT_CLAMP_CHARS, CHIPS_PREVIEW, LIST_PREVIEW, PASSAGES_PREVIEW, SCORE_DECIMALS, SNIPPET_CLAMP_CHARS } from "../constants";
import { formatAbsolute, formatCount, formatNumber, humanize, parseDate } from "../format";
import { authorsOf, doiHref, isRecord, num, pickNum, pickRecords, pickStr, type Rec, records, rowKey, safeHref, str, strings } from "../parse";
import { ClampText, Empty, ExtLink, Meta, Notice, Pill, Section, ShowAll, usePreview } from "../primitives";

const YEAR = /^(\d{4})/;

function yearOf(paper: Rec): string | null {
  const year = num(paper.year);
  if (year !== null) return String(year);
  const date = pickStr(paper, "published", "created", "updated", "date");
  return date ? (YEAR.exec(date)?.[1] ?? null) : null;
}

function Links({ paper }: { paper: Rec }) {
  const page = safeHref(paper.url);
  const doi = doiHref(paper.doi);
  const pdf = safeHref(paper.pdf_url);
  const open = safeHref(paper.open_access_url);
  const links: Array<[string, string]> = [];
  if (page && page !== doi) links.push(["Page", page]);
  if (doi) links.push([`DOI ${str(paper.doi)}`, doi]);
  if (pdf) links.push(["PDF", pdf]);
  if (open && open !== pdf && open !== doi && open !== page) links.push(["Open access", open]);
  if (links.length === 0) return null;
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {links.map(([label, href]) => (
        <ExtLink key={label} href={href} icon className="max-w-full truncate">
          {label}
        </ExtLink>
      ))}
    </p>
  );
}

function Retraction({ paper }: { paper: Rec }) {
  const retracted = paper.retracted === true || paper.is_retracted === true;
  const notices = records(paper.updated_by);
  if (!retracted && notices.length === 0) return null;
  return (
    <Notice className="mt-2">
      {retracted ? "Retracted." : "Updated."}{" "}
      {notices.map((notice, i) => (
        <span key={rowKey(notice, i, "doi")} className="mr-2">
          <ExtLink href={doiHref(notice.doi)}>{pickStr(notice, "label", "type") ?? "Notice"}</ExtLink>
          {str(notice.date) && <span className="text-muted-foreground"> {formatAbsolute(notice.date)}</span>}
        </span>
      ))}
    </Notice>
  );
}

function Paper({ paper }: { paper: Rec }) {
  const title = pickStr(paper, "title") ?? "Untitled";
  const href = safeHref(paper.url) ?? doiHref(paper.doi) ?? safeHref(paper.open_access_url);
  const venue = pickStr(paper, "venue", "journal_ref", "publication_info", "publisher", "primary_category");
  const cited = num(paper.cited_by);
  const references = num(paper.references);
  const score = num(paper.score);
  const categories = strings(paper.categories).slice(0, CHIPS_PREVIEW);
  const abstract = pickStr(paper, "abstract", "snippet", "summary");
  const date = pickStr(paper, "published", "created");
  const parsed = parseDate(date);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <h4 className="text-[0.9375rem] leading-snug font-medium">
        <ExtLink href={href} className="text-foreground hover:text-brand">
          {title}
        </ExtLink>
      </h4>
      {authorsOf(paper.authors) && <p className="mt-0.5 text-[0.8125rem] text-ink-2">{authorsOf(paper.authors)}</p>}
      <Meta className="mt-1">
        {parsed && !parsed.dateOnly ? <span title={date ?? undefined}>{formatAbsolute(date)}</span> : yearOf(paper)}
        {venue && <span className="italic">{venue}</span>}
        {str(paper.type) && <Pill tone="outline">{humanize(str(paper.type) ?? "")}</Pill>}
        {cited !== null && `${formatCount(cited)} ${cited === 1 ? "citation" : "citations"}`}
        {references !== null && `${formatCount(references)} references`}
        {score !== null && <span className="font-mono">score {formatNumber(score, SCORE_DECIMALS)}</span>}
        {pickStr(paper, "paper_id", "id", "scholar_id") && <span className="font-mono">{pickStr(paper, "paper_id", "id", "scholar_id")}</span>}
      </Meta>
      <Retraction paper={paper} />
      {abstract && <ClampText text={abstract} chars={ABSTRACT_CLAMP_CHARS} className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-2" />}
      {str(paper.topic) && <p className="mt-1 text-xs text-muted-foreground">Topic: {str(paper.topic)}</p>}
      {categories.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {categories.map((c) => (
            <li key={c}>
              <Pill>{c}</Pill>
            </li>
          ))}
        </ul>
      )}
      <Links paper={paper} />
    </li>
  );
}

function Passages({ passages }: { passages: Rec[] }) {
  const { shown, expanded, toggle, total } = usePreview(passages, PASSAGES_PREVIEW);
  return (
    <Section label="Passages">
      <ul className="space-y-2">
        {shown.map((passage, i) => (
          <li key={i} className="border-l-2 border-line pl-3">
            <ClampText text={pickStr(passage, "text", "content") ?? ""} chars={SNIPPET_CLAMP_CHARS} className="text-[0.8125rem] text-ink-2" />
            {num(passage.score) !== null && (
              <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">score {formatNumber(num(passage.score) ?? 0, SCORE_DECIMALS)}</p>
            )}
          </li>
        ))}
      </ul>
      <ShowAll total={total} limit={PASSAGES_PREVIEW} expanded={expanded} onToggle={toggle} noun="passages" />
    </Section>
  );
}

/** Scholarly works from arXiv, OpenAlex, Crossref, Scholar and Firecrawl's paper index. */
export function PapersCard({ data }: { data: Rec }) {
  const listed = pickRecords(data, "papers", "results", "works", "items");
  const papers = listed.length > 0 ? listed : isRecord(data.paper) ? [data.paper] : [];
  const { shown, expanded, toggle, total } = usePreview(papers, LIST_PREVIEW);
  const query = pickStr(data, "query");
  const count = pickNum(data, "total");
  const mode = str(data.mode);
  const passages = records(data.passages).filter((p) => pickStr(p, "text", "content"));
  return (
    <div>
      {(query || count !== null || mode) && (
        <p className="mb-3 text-[0.8125rem] text-muted-foreground">
          {mode && `${humanize(mode)} papers${str(data.paper_id) ? ` for ${str(data.paper_id)}` : ""}`}
          {query && <span className="text-foreground">“{query}”</span>}
          {count !== null && ` · ${formatCount(count)} ${count === 1 ? "match" : "matches"}`}
        </p>
      )}
      {papers.length === 0 ? (
        <Empty>No papers.</Empty>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {shown.map((paper, index) => (
              <Paper key={rowKey(paper, index, "doi", "paper_id")} paper={paper} />
            ))}
          </ol>
          <ShowAll total={total} limit={LIST_PREVIEW} expanded={expanded} onToggle={toggle} noun="papers" />
        </>
      )}
      {passages.length > 0 && <Passages passages={passages} />}
    </div>
  );
}
