"use client";

import { Volume2 } from "lucide-react";

import { CHIPS_PREVIEW, DEFINITIONS_PREVIEW } from "../constants";
import { hostOf, pickRecords, pickStr, type Rec, records, rowKey, safeHref, str, strings } from "../parse";
import { Empty, ExtLink, Label, ShowAll, usePreview } from "../primitives";

function Listen({ src, word }: { src: unknown; word: string }) {
  const safe = safeHref(src);
  if (!safe) return null;
  return (
    <button
      type="button"
      onClick={() => void new Audio(safe).play().catch(() => undefined)}
      aria-label={`Hear “${word}”`}
      className="inline-flex size-7 items-center justify-center rounded-full border border-line text-ink-2 transition-colors hover:border-line-default hover:text-brand"
    >
      <Volume2 className="size-3.5" aria-hidden />
    </button>
  );
}

function WordList({ label, words }: { label: string; words: string[] }) {
  if (words.length === 0) return null;
  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-ink-2">{label}:</span> {words.slice(0, CHIPS_PREVIEW).join(", ")}
    </p>
  );
}

function Meaning({ meaning }: { meaning: Rec }) {
  const definitions = records(meaning.definitions).filter((d) => pickStr(d, "definition", "text"));
  const { shown, expanded, toggle, total } = usePreview(definitions, DEFINITIONS_PREVIEW);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <Label>{pickStr(meaning, "part_of_speech", "partOfSpeech", "pos") ?? "meaning"}</Label>
      <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-[0.875rem] leading-relaxed text-foreground marker:text-muted-foreground">
        {shown.map((d, i) => (
          <li key={i}>
            {pickStr(d, "definition", "text")}
            {str(d.example) && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground italic">“{str(d.example)}”</p>}
          </li>
        ))}
      </ol>
      <ShowAll total={total} limit={DEFINITIONS_PREVIEW} expanded={expanded} onToggle={toggle} noun="definitions" />
      <WordList label="Synonyms" words={strings(meaning.synonyms)} />
      <WordList label="Antonyms" words={strings(meaning.antonyms)} />
    </li>
  );
}

function Entry({ entry }: { entry: Rec }) {
  const word = pickStr(entry, "word", "term", "headword") ?? "";
  const meanings = pickRecords(entry, "meanings", "senses");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className="font-display text-2xl font-semibold tracking-[-0.03em] text-foreground">{word}</h4>
        {pickStr(entry, "phonetic", "pronunciation") && <span className="font-mono text-[0.875rem] text-ink-2">{pickStr(entry, "phonetic", "pronunciation")}</span>}
        <Listen src={entry.audio} word={word} />
      </div>
      {str(entry.origin) && <p className="mt-1 text-[0.8125rem] text-muted-foreground">Origin: {str(entry.origin)}</p>}
      {meanings.length > 0 ? (
        <ol className="mt-3 divide-y divide-line">
          {meanings.map((meaning, index) => (
            <Meaning key={rowKey(meaning, index, "part_of_speech")} meaning={meaning} />
          ))}
        </ol>
      ) : (
        <Empty>No definitions.</Empty>
      )}
      {safeHref(entry.source_url) && (
        <p className="mt-3 text-xs text-muted-foreground">
          From <ExtLink href={entry.source_url}>{hostOf(entry.source_url)}</ExtLink>
        </p>
      )}
    </div>
  );
}

/** Dictionary entries (dictionary/define): word, phonetic, meanings by part of speech, synonyms. */
export function DefinitionCard({ data }: { data: Rec }) {
  const listed = pickRecords(data, "entries", "results");
  const entries = listed.length > 0 ? listed : [data];
  return (
    <div className="space-y-5">
      {entries.map((entry, index) => (
        <Entry key={rowKey(entry, index, "word")} entry={entry} />
      ))}
    </div>
  );
}
