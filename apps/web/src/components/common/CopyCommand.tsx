"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const COPIED_MS = 1600;

/** Monid's dark command box: `$ <command>` in mono with the accent copy button on the right. */
export function CopyCommand({ command, className, wrap = false }: { command: string; className?: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 rounded-md bg-dark py-2.5 pr-2.5 pl-4 font-mono text-[0.8125rem] text-white shadow-window",
        className,
      )}
    >
      <span className="text-on-dark-muted select-none" aria-hidden>
        $
      </span>
      <code className={cn("min-w-0 flex-1 text-left", wrap ? "whitespace-pre-wrap break-words" : "truncate")}>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-brand text-primary-foreground transition-colors hover:bg-brand-hover active:bg-brand-press"
        aria-label={copied ? "Copied" : "Copy command"}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
