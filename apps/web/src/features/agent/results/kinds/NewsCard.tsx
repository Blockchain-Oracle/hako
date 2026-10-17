"use client";

import { TrendingUp } from "lucide-react";

import { LIST_PREVIEW, SNIPPET_CLAMP_CHARS } from "../constants";
import { formatCount } from "../format";
import { hostOf, num, pickRecords, pickStr, type Rec, rowKey, str, strings } from "../parse";
import { ClampText, Empty, ExtLink, Meta, Pill, ShowAll, TimeAgo, usePreview } from "../primitives";

// hako/news names its feeds by id; everything else sends a publisher name.
const FEED_LABELS: Record<string, string> = { hn: "Hacker News", gdelt: "GDELT" };

function Article({ item }: { item: Rec }) {
  const url = pickStr(item, "url", "link");
  const source = pickStr(item, "source");
  const feed = source ? FEED_LABELS[source] : undefined;
  const publisher = pickStr(item, "publisher", "domain") ?? (feed ? null : source) ?? hostOf(url);
  const when = item.published ?? item.seen_at ?? item.date;
  const points = num(item.points);
  const alsoIn = strings(item.also_in).map((s) => FEED_LABELS[s] ?? s);
  const snippet = pickStr(item, "snippet", "description", "summary");
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <Meta>
        {publisher && <span className="font-medium text-muted-foreground">{publisher}</span>}
        {str(when) && <TimeAgo value={when} />}
        {feed && <Pill tone="outline">{feed}</Pill>}
        {points !== null && (
          <span className="inline-flex items-center gap-0.5">
            <TrendingUp className="size-3" aria-hidden /> {formatCount(points)}
          </span>
        )}
        {alsoIn.length > 0 && `also in ${alsoIn.join(", ")}`}
      </Meta>
      <h4 className="mt-0.5 text-[0.9375rem] leading-snug font-medium">
        <ExtLink href={url} className="text-foreground hover:text-link">
          {pickStr(item, "title", "headline") ?? url ?? "Untitled"}
        </ExtLink>
      </h4>
      {snippet && <ClampText text={snippet} chars={SNIPPET_CLAMP_CHARS} className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground" />}
    </li>
  );
}

/** Headlines (hako/news, serper/news): publisher, how long ago, snippet and link. */
export function NewsCard({ data }: { data: Rec }) {
  const articles = pickRecords(data, "articles", "results", "news", "items");
  const { shown, expanded, toggle, total } = usePreview(articles, LIST_PREVIEW);
  const query = pickStr(data, "query");
  return (
    <div>
      {query && (
        <p className="mb-3 text-[0.8125rem] text-muted-foreground">
          <span className="text-foreground">“{query}”</span> · {articles.length} {articles.length === 1 ? "story" : "stories"}
        </p>
      )}
      {articles.length === 0 ? (
        <Empty>No stories matched.</Empty>
      ) : (
        <>
          <ol className="divide-y divide-border">
            {shown.map((item, index) => (
              <Article key={rowKey(item, index)} item={item} />
            ))}
          </ol>
          <ShowAll total={total} limit={LIST_PREVIEW} expanded={expanded} onToggle={toggle} noun="stories" />
        </>
      )}
    </div>
  );
}
