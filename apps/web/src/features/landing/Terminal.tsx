"use client";

import { useEffect, useRef, useState } from "react";

import { TERMINAL_SCRIPT } from "@/lib/constants/landing";
import { cn } from "@/lib/utils";

const STEP_MS = 650;
const VISIBLE_THRESHOLD = 0.35;

/** A dark window that replays an agent's discover → run → pay session once it scrolls into view. */
export function Terminal() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && setStarted(true),
      { threshold: VISIBLE_THRESHOLD },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started || shown >= TERMINAL_SCRIPT.steps.length) return;
    const timer = setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [started, shown]);

  return (
    <div ref={ref} className="mx-auto mt-16 max-w-[820px] overflow-hidden rounded-lg bg-dark text-left shadow-window">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
          </span>
          <span className="font-mono text-xs text-on-dark-muted">{TERMINAL_SCRIPT.path}</span>
        </div>
        <span className="rounded-sm bg-brand px-2 py-0.5 font-mono text-[0.6875rem] text-primary-foreground">
          wallet · ${TERMINAL_SCRIPT.balance}
        </span>
      </div>
      <div className="min-h-[300px] space-y-2 px-5 py-5 font-mono text-[0.8125rem] leading-relaxed">
        <p className="text-white">
          <span className="text-on-dark-muted">$ </span>
          {TERMINAL_SCRIPT.prompt}
        </p>
        {TERMINAL_SCRIPT.steps.slice(0, shown).map((step) => (
          <p
            key={step.text}
            className={cn(
              "animate-in fade-in slide-in-from-bottom-1 duration-300",
              step.kind === "call" && "text-brand-on-dark",
              step.kind === "result" && "pl-4 text-on-dark-muted",
              step.kind === "paid" && "text-success-on-dark",
            )}
          >
            {step.kind === "call" ? "› " : ""}
            {step.text}
          </p>
        ))}
        {shown < TERMINAL_SCRIPT.steps.length && <span className="caret inline-block h-4 w-2 bg-white/70" aria-hidden />}
      </div>
    </div>
  );
}
