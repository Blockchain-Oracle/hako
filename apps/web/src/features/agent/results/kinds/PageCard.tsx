"use client";

import { MARKDOWN_CLAMP_CHARS, THUMB_PX } from "../constants";
import { Markdown } from "../Markdown";
import { hostOf, num, pickStr, type Rec, str } from "../parse";
import { Empty, ExtLink, Meta, Pill, Thumb, TimeAgo } from "../primitives";

const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

/** One page read as markdown (firecrawl/scrape, jina/read, wikipedia/summary): title, source, clamped body. */
export function PageCard({ data }: { data: Rec }) {
  const url = pickStr(data, "url", "source_url");
  const title = pickStr(data, "title") ?? hostOf(url) ?? "Page";
  const body = pickStr(data, "markdown", "content", "text", "extract");
  const status = num(data.status_code);
  const updated = data.published ?? data.last_edited ?? data.updated;
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-display text-lg leading-tight font-semibold tracking-[-0.02em]">
            <ExtLink href={url} className="text-foreground hover:text-brand">
              {title}
            </ExtLink>
          </h4>
          {str(data.description) && <p className="mt-1 text-[0.8125rem] text-ink-2">{str(data.description)}</p>}
          <Meta className="mt-1.5">
            {hostOf(url) && <span>{hostOf(url)}</span>}
            {pickStr(data, "language", "lang")?.toUpperCase()}
            {str(updated) && <TimeAgo value={updated} />}
            {str(data.wikidata_id) && <span className="font-mono">{str(data.wikidata_id)}</span>}
            {status !== null && (status < HTTP_OK_MIN || status > HTTP_OK_MAX) && <Pill tone="outline">HTTP {status}</Pill>}
          </Meta>
        </div>
        <Thumb src={data.thumbnail ?? data.image} alt="" width={THUMB_PX} height={THUMB_PX} className="size-14" />
      </div>
      <div className="mt-3 border-t border-line pt-2">
        {body ? <Markdown clampChars={MARKDOWN_CLAMP_CHARS}>{body}</Markdown> : <Empty>The page had no readable text.</Empty>}
      </div>
    </div>
  );
}
