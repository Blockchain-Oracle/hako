"use client";

import { Archive, GitFork, MessageSquare, Star, TrendingUp } from "lucide-react";
import { useState } from "react";

import { CONTENT_CLAMP_CHARS, IMAGE_TILE_PX, LIST_PREVIEW, PASSAGES_PREVIEW, SNIPPET_CLAMP_CHARS } from "../constants";
import { formatCount, humanize } from "../format";
import { Markdown } from "../Markdown";
import { hostOf, num, pickNum, pickRecords, pickStr, type Rec, rec, records, rowKey, safeHref, str, strings } from "../parse";
import { ClampText, Empty, ExtLink, KeyValues, Label, Meta, Pill, Section, ShowAll, Thumb, TimeAgo, usePreview } from "../primitives";
import { inlineEntries, ScalarValue } from "../Value";

function Stats({ item }: { item: Rec }) {
  const stars = num(item.stars);
  const forks = num(item.forks);
  const points = num(item.points);
  const comments = num(item.num_comments);
  return (
    <Meta>
      {stars !== null && (
        <span className="inline-flex items-center gap-0.5">
          <Star className="size-3" aria-hidden /> {formatCount(stars)}
        </span>
      )}
      {forks !== null && (
        <span className="inline-flex items-center gap-0.5">
          <GitFork className="size-3" aria-hidden /> {formatCount(forks)}
        </span>
      )}
      {str(item.language)}
      {points !== null && (
        <span className="inline-flex items-center gap-0.5">
          <TrendingUp className="size-3" aria-hidden /> {formatCount(points)} points
        </span>
      )}
      {comments !== null && (
        <ExtLink href={item.hn_url} className="inline-flex items-center gap-0.5 text-muted-foreground">
          <MessageSquare className="size-3" aria-hidden /> {formatCount(comments)}
        </ExtLink>
      )}
      {str(item.author) && `by ${str(item.author)}`}
      {item.archived === true && (
        <span className="inline-flex items-center gap-0.5">
          <Archive className="size-3" aria-hidden /> archived
        </span>
      )}
    </Meta>
  );
}

function PageText({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-[0.8125rem] font-medium text-brand underline-offset-4 hover:underline"
      >
        {open ? "Hide page text" : "Read page text"}
      </button>
      {open && (
        <div className="mt-2 rounded-sm border border-line bg-subtle px-3 py-1">
          <Markdown clampChars={CONTENT_CLAMP_CHARS}>{content}</Markdown>
        </div>
      )}
    </div>
  );
}

function Result({ item }: { item: Rec }) {
  const url = pickStr(item, "url", "link", "hn_url");
  const title = pickStr(item, "title", "story_title", "name") ?? url ?? "Untitled";
  const host = pickStr(item, "source", "domain", "displayed_link") ?? hostOf(url);
  const position = num(item.position);
  const kind = str(item.kind);
  const passages = strings(item.passages);
  const content = str(item.content);
  const snippet = pickStr(item, "snippet", "description", "summary");
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <Meta>
        {position !== null && <span className="font-mono">#{position}</span>}
        {host && <span className="truncate">{host}</span>}
        {kind && <Pill tone="outline">{humanize(kind)}</Pill>}
        {str(item.id) && <span className="font-mono">{str(item.id)}</span>}
        {(str(item.published) || str(item.pushed_at)) && <TimeAgo value={item.published ?? item.pushed_at} />}
      </Meta>
      <h4 className="mt-0.5 text-[0.9375rem] leading-snug font-medium">
        <ExtLink href={url} className="text-foreground hover:text-brand">
          {title}
        </ExtLink>
      </h4>
      {snippet && <ClampText text={snippet} chars={SNIPPET_CLAMP_CHARS} className="mt-1 text-[0.8125rem] leading-relaxed text-ink-2" />}
      <div className="mt-1">
        <Stats item={item} />
      </div>
      {passages.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-line pl-3">
          {passages.slice(0, PASSAGES_PREVIEW).map((passage, i) => (
            <li key={i}>
              <ClampText text={passage} chars={SNIPPET_CLAMP_CHARS} className="text-[0.8125rem] text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
      {content && <PageText content={content} />}
    </li>
  );
}

function ImageGrid({ items }: { items: Rec[] }) {
  const { shown, expanded, toggle, total } = usePreview(items, LIST_PREVIEW * 2);
  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shown.map((item, index) => {
          const page = pickStr(item, "url", "link");
          return (
            <li key={rowKey(item, index, "image_url")} className="min-w-0">
              <ExtLink href={item.image_url ?? page} className="block" title={pickStr(item, "title") ?? undefined}>
                <Thumb
                  src={item.thumbnail_url ?? item.image_url}
                  alt={pickStr(item, "title") ?? ""}
                  width={IMAGE_TILE_PX}
                  height={IMAGE_TILE_PX}
                  className="aspect-square h-auto w-full"
                />
              </ExtLink>
              <p className="mt-1 truncate text-xs text-ink-2">{pickStr(item, "title")}</p>
              <p className="truncate text-[0.6875rem] text-muted-foreground">{pickStr(item, "source") ?? hostOf(page)}</p>
            </li>
          );
        })}
      </ul>
      <ShowAll total={total} limit={LIST_PREVIEW * 2} expanded={expanded} onToggle={toggle} noun="images" />
    </div>
  );
}

function AnswerBox({ box }: { box: Rec }) {
  const answer = pickStr(box, "answer", "snippet");
  if (!answer) return null;
  return (
    <div className="mb-4 rounded-sm bg-subtle px-3 py-2.5">
      <Label>Answer box</Label>
      <p className="mt-1 text-[0.9375rem] font-medium text-foreground">{answer}</p>
      {str(box.answer) && str(box.snippet) && <p className="mt-1 text-[0.8125rem] text-ink-2">{str(box.snippet)}</p>}
      {(str(box.title) || str(box.url)) && (
        <ExtLink href={box.url ?? box.link} className="mt-1 inline-block text-xs">
          {pickStr(box, "title") ?? hostOf(box.url)}
        </ExtLink>
      )}
    </div>
  );
}

function KnowledgePanel({ panel }: { panel: Rec }) {
  const title = str(panel.title);
  if (!title) return null;
  const attributes = inlineEntries(rec(panel.attributes));
  return (
    <div className="mb-4 rounded-sm border border-line px-3 py-2.5">
      <p className="font-display text-base font-semibold tracking-[-0.02em]">{title}</p>
      {str(panel.type) && <p className="text-xs text-muted-foreground">{str(panel.type)}</p>}
      {str(panel.description) && <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-2">{str(panel.description)}</p>}
      {attributes.length > 0 && (
        <KeyValues className="mt-2" rows={attributes.map(([key, value]) => [key, <ScalarValue key={key} name={key} value={value} />])} />
      )}
      <Meta className="mt-2">
        {safeHref(panel.website) && <ExtLink href={panel.website}>{hostOf(panel.website)}</ExtLink>}
        {safeHref(panel.source_url) && <ExtLink href={panel.source_url}>Source: {hostOf(panel.source_url)}</ExtLink>}
      </Meta>
    </div>
  );
}

function PeopleAlsoAsk({ items }: { items: Rec[] }) {
  return (
    <Section label="People also ask">
      <ul className="space-y-2">
        {items.slice(0, LIST_PREVIEW).map((item, index) => (
          <li key={rowKey(item, index, "question")}>
            <p className="text-[0.8125rem] font-medium text-foreground">{str(item.question)}</p>
            {str(item.snippet) && <ClampText text={str(item.snippet) ?? ""} chars={SNIPPET_CLAMP_CHARS} className="text-xs text-ink-2" />}
            {safeHref(item.url) && <ExtLink href={item.url} className="text-xs">{hostOf(item.url)}</ExtLink>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Web, code, HN, Wikipedia/Wikidata and image search: ranked links with whatever extras the provider sends. */
export function SearchResultsCard({ data }: { data: Rec }) {
  const items = pickRecords(data, "results", "links", "items", "organic");
  const { shown, expanded, toggle, total } = usePreview(items, LIST_PREVIEW);
  const site = hostOf(data.site);
  const query = pickStr(data, "query", "q") ?? (site ? null : pickStr(data, "site"));
  const count = pickNum(data, "total", "total_count", "total_results");
  const isImages = items.length > 0 && items.every((item) => safeHref(item.image_url ?? item.thumbnail_url));
  const related = strings(data.related_searches);
  const ask = records(data.people_also_ask);
  return (
    <div>
      {(query || site || count !== null) && (
        <p className="mb-3 text-[0.8125rem] text-muted-foreground">
          {query && <span className="text-foreground">“{query}”</span>}
          {site && !query && (
            <span>
              Pages on <span className="text-foreground">{site}</span>
            </span>
          )}
          {count !== null && ` · ${formatCount(count)} ${count === 1 ? "match" : "matches"}`}
        </p>
      )}
      <AnswerBox box={rec(data.answer_box ?? data.answerBox)} />
      <KnowledgePanel panel={rec(data.knowledge_panel ?? data.knowledgeGraph)} />
      {items.length === 0 ? (
        <Empty>No results.</Empty>
      ) : isImages ? (
        <ImageGrid items={items} />
      ) : (
        <>
          <ol className="divide-y divide-line">
            {shown.map((item, index) => (
              <Result key={rowKey(item, index)} item={item} />
            ))}
          </ol>
          <ShowAll total={total} limit={LIST_PREVIEW} expanded={expanded} onToggle={toggle} noun="results" />
        </>
      )}
      {ask.length > 0 && <PeopleAlsoAsk items={ask} />}
      {related.length > 0 && (
        <Section label="Related searches">
          <ul className="flex flex-wrap gap-1.5">
            {related.map((term) => (
              <li key={term} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2">
                {term}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
