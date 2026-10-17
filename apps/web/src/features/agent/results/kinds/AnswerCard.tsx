"use client";

import { type ReactNode, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { formatCount } from "../format";
import { hostOf, num, pickRecords, pickStr, type Rec, rowKey, str, strings } from "../parse";
import { ExtLink, Label, Meta, Section } from "../primitives";

// [1], [1, 3] (the gateway normalises 【1】 to these) and **bold**: the only markup an answer carries.
const TOKEN = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]|\*\*([^*\n]+)\*\*/g;
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
const PARAGRAPH = /\n{2,}/;
const NON_ID = /[^a-zA-Z0-9_-]/g;

interface Citation {
  n: number;
  title: string;
  url: string | null;
}

function readCitations(data: Rec): Citation[] {
  return pickRecords(data, "citations", "sources", "references").map((c, i) => {
    const url = pickStr(c, "url", "link");
    return { n: num(c.index) ?? i + 1, title: pickStr(c, "title", "name") ?? hostOf(url) ?? url ?? `Source ${i + 1}`, url };
  });
}

/** Moves to citation n in the list below (no hash navigation: the chat URL stays as it is). */
interface Jump {
  go: (n: number) => void;
  href: (n: number) => string;
}

function Inline({ text, cited, jump }: { text: string; cited: Set<number>; jump: Jump }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (match[1]) {
      match[1].split(",").forEach((part) => {
        const n = Number(part.trim());
        out.push(
          cited.has(n) ? (
            <sup key={`${at}-${n}`} className="ml-px">
              <a
                href={jump.href(n)}
                onClick={(event) => {
                  event.preventDefault();
                  jump.go(n);
                }}
                className="rounded-sm bg-selected-row px-1 font-mono text-[0.625rem] font-medium text-link no-underline hover:bg-primary hover:text-background"
                aria-label={`Source ${n}`}
              >
                {n}
              </a>
            </sup>
          ) : (
            <span key={`${at}-${n}`} className="text-muted-foreground">{`[${n}]`}</span>
          ),
        );
      });
    } else if (match[2]) {
      out.push(
        <strong key={at} className="font-semibold text-foreground">
          {match[2]}
        </strong>,
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Paragraphs, bullet runs and inline citations; everything else is plain text. */
function AnswerText({ text, cited, jump }: { text: string; cited: Set<number>; jump: Jump }) {
  return (
    <div className="space-y-2.5 text-[0.9375rem] leading-relaxed text-foreground">
      {text.split(PARAGRAPH).map((paragraph, pi) => {
        const lines = paragraph.split("\n").filter((line) => line.trim());
        if (lines.length > 0 && lines.every((line) => BULLET.test(line))) {
          return (
            <ul key={pi} className="list-disc space-y-1 pl-5">
              {lines.map((line, li) => (
                <li key={li}>
                  <Inline text={line.replace(BULLET, "")} cited={cited} jump={jump} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={pi} className="break-words whitespace-pre-line">
            <Inline text={paragraph.trim()} cited={cited} jump={jump} />
          </p>
        );
      })}
    </div>
  );
}

/** A written answer (hako/answer, firecrawl/ask-page, groq/summarize) with its numbered sources. */
export function AnswerCard({ data }: { data: Rec }) {
  const answer = pickStr(data, "answer", "summary", "text");
  const citations = readCitations(data);
  const keyPoints = strings(data.key_points ?? data.points);
  const cited = new Set(citations.map((c) => c.n));
  const listRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const scope = useId().replace(NON_ID, "");
  const sourcesRead = num(data.sources_read);
  const sourceChars = num(data.source_chars);
  const jump: Jump = {
    href: (n) => `#${scope}-cite-${n}`,
    go: (n) => {
      setActive(n);
      listRef.current?.querySelector(`[data-cite="${n}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
  };
  return (
    <div>
      {str(data.question) && <p className="mb-2 text-[0.8125rem] text-muted-foreground">{str(data.question)}</p>}
      {answer ? <AnswerText text={answer} cited={cited} jump={jump} /> : <p className="text-sm text-muted-foreground">No answer text.</p>}
      {keyPoints.length > 0 && (
        <Section label="Key points">
          <ul className="list-disc space-y-1 pl-5 text-[0.875rem] text-muted-foreground">
            {keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </Section>
      )}
      <Meta className="mt-3">
        {str(data.url) && (
          <span>
            Read from <ExtLink href={data.url}>{hostOf(data.url) ?? str(data.url)}</ExtLink>
          </span>
        )}
        {sourcesRead !== null && `${sourcesRead} ${sourcesRead === 1 ? "page" : "pages"} read in full`}
        {sourceChars !== null && `${formatCount(sourceChars)} characters summarised`}
      </Meta>
      {citations.length > 0 && (
        <section className="mt-4 border-t border-border pt-3">
          <Label>Citations</Label>
          <ol ref={listRef} className="mt-2 space-y-1">
            {citations.map((c, index) => (
              <li
                key={rowKey({ url: c.url }, index)}
                id={`${scope}-cite-${c.n}`}
                data-cite={c.n}
                className={cn(
                  "flex min-w-0 items-baseline gap-2 rounded-sm px-1.5 py-1 text-[0.8125rem] transition-colors",
                  active === c.n && "bg-selected-row",
                )}
              >
                <span className="w-5 shrink-0 font-mono text-[0.6875rem] text-muted-foreground">{c.n}</span>
                <span className="min-w-0">
                  <ExtLink href={c.url} className="text-foreground hover:text-link">
                    {c.title}
                  </ExtLink>
                  {hostOf(c.url) && <span className="ml-1.5 text-xs text-muted-foreground">{hostOf(c.url)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
