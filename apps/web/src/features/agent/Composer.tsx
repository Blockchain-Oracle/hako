"use client";

import { ArrowUp, Square } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";

import { MAX_INPUT_CHARS } from "@/lib/constants/agent";

const MAX_HEIGHT_PX = 220;

/** The prompt box (KeeperHub's composer, simplified): auto-growing text, Enter to send, Shift+Enter for a new line. */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);
  const canSend = value.trim().length > 0 && !busy;
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };
  return (
    <div className="rounded-lg border border-border bg-background focus-within:border-ring">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_INPUT_CHARS))}
        onKeyDown={onKey}
        rows={1}
        placeholder="Ask anything that needs live data…"
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.9375rem] outline-none placeholder:text-muted-foreground"
        aria-label="Message the agent"
      />
      <div className="flex items-center justify-end gap-3 px-3 pb-3">
        {busy ? (
          <button type="button" onClick={onStop} className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-label="Stop">
            <Square className="size-3.5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary-pressed disabled:bg-border"
            aria-label="Send"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
