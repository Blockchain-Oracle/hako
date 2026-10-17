"use client";

import { CircleSlash } from "lucide-react";

import { readError } from "./envelope";
import { humanize } from "./format";
import { Pill } from "./primitives";

/** A failed run: what went wrong, calmly, and that nothing was charged. */
export function ErrorCard({ status, error, note }: { status: number; error: unknown; note?: string }) {
  const { code, message, details } = readError(error);
  const label = code ? humanize(code) : "The run failed";
  return (
    <article className="w-full min-w-0 rounded-md border border-line bg-background p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-ink-2">
          <CircleSlash className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.9375rem] font-medium text-foreground">{label}</p>
            {Number.isFinite(status) && status > 0 && <Pill tone="outline">HTTP {status}</Pill>}
            {code && <span className="font-mono text-[0.6875rem] text-muted-foreground">{code}</span>}
          </div>
          {message && <p className="mt-1 text-[0.875rem] break-words text-ink-2">{message}</p>}
          {details.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs break-words text-muted-foreground">
              {details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
          {note && <p className="mt-1.5 text-xs break-words text-muted-foreground">{note}</p>}
          <p className="mt-2.5 text-xs text-success">Not charged — failed runs never settle.</p>
        </div>
      </div>
    </article>
  );
}
