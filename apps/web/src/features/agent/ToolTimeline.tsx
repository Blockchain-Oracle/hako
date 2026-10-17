"use client";

import { BookOpen, ChevronDown, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { ProviderLogo } from "@/components/common/ProviderLogo";
import { formatPrice } from "@/lib/catalog/format";
import { TOOL_VERBS } from "@/lib/constants/agent";
import { cn } from "@hako/ui/lib/utils";

import { useEndpoint } from "./endpoints-context";
import { isRunning, runOutput, type ToolPart, toolName } from "./parts";

/*
 * Ported from KeeperHub Copilot v2 (same author) components/chat/tool-timeline.tsx (21st heygaia/tool-calls-section +
 * serafimcloud/tool-group): tilted marks and "Used N tools" behind a chevron; open, every call is a row on a
 * connector line. Changes: Senryo tokens (@hako/brand); three tools (find / inspect / run) with the run's provider mark and price.
 */
const MAX_ICONS = 6;
const TILT_DEG = 8;
const MS_PER_S = 1000;
const SECONDS_PER_MINUTE = 60;

function useElapsed(running: boolean): string | undefined {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), MS_PER_S);
    return () => clearInterval(timer);
  }, [running]);
  if (!running) return undefined;
  const seconds = Math.max(0, Math.floor((now - startedAt) / MS_PER_S));
  return seconds < SECONDS_PER_MINUTE ? `${seconds}s` : `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
}

function CallIcon({ part }: { part: ToolPart }) {
  const endpoint = useEndpoint(String(part.input?.id ?? ""));
  const name = toolName(part);
  if (name === "run_tool" && endpoint) return <ProviderLogo id={endpoint.provider} name={endpoint.providerName} size="sm" />;
  const Icon = name === "find_tools" ? Search : BookOpen;
  return (
    <span className="flex size-5 items-center justify-center rounded-[6px] border border-border bg-background text-link">
      <Icon className="size-3" aria-hidden />
    </span>
  );
}

function CallRow({ part, last }: { part: ToolPart; last: boolean }) {
  const [open, setOpen] = useState(false);
  const name = toolName(part);
  const id = String(part.input?.id ?? "");
  const endpoint = useEndpoint(id);
  const run = runOutput(part);
  const failed = part.state === "output-error";
  const title =
    name === "find_tools"
      ? `Searched the catalog for "${String(part.input?.query ?? "")}"`
      : name === "inspect_tool"
        ? `Read ${id}`
        : `Proposed a run of ${endpoint?.displayName ?? id}`;
  const meta = isRunning(part)
    ? TOOL_VERBS[name]
    : name === "run_tool" && run
      ? run.reason === "paybox_not_connected"
        ? `${formatPrice(run.priceUsd ?? endpoint?.price.usd ?? "0")} · not run, needs PayBox`
        : "not run · not charged"
      : "free";
  return (
    <div className="flex items-stretch gap-2.5">
      <div className="flex flex-col items-center self-stretch">
        <div className="flex min-h-7 items-center">
          <CallIcon part={part} />
        </div>
        {!last && <div className="min-h-3 w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="group flex items-center gap-1 text-left" aria-expanded={open}>
          <span className={cn("text-xs font-medium", failed ? "text-destructive" : "text-muted-foreground group-hover:text-foreground")}>{title}</span>
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        <p className="font-mono text-[0.6875rem] text-muted-foreground">{failed ? "failed · not charged" : meta}</p>
        {open && (
          <pre className="mt-2 max-h-56 overflow-auto rounded-sm bg-card p-2.5 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
            {JSON.stringify(part.input ?? {}, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function ToolTimeline({ parts, live }: { parts: ToolPart[]; live: boolean }) {
  const running = live && parts.some(isRunning);
  const elapsed = useElapsed(running);
  const [open, setOpen] = useState(false);
  if (parts.length === 0) return null;
  const icons = parts.slice(0, MAX_ICONS);
  return (
    <div className="w-fit max-w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 py-1.5 text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center -space-x-1.5">
          {icons.map((part, index) => (
            <span key={part.toolCallId} style={{ rotate: icons.length > 1 ? `${index % 2 ? -TILT_DEG : TILT_DEG}deg` : "0deg", zIndex: index }}>
              <CallIcon part={part} />
            </span>
          ))}
        </span>
        <span className={cn("text-xs font-medium", running && "tool-shimmer")}>
          {running ? `Using ${parts.length} tool${parts.length === 1 ? "" : "s"}` : `Used ${parts.length} tool${parts.length === 1 ? "" : "s"}`}
        </span>
        {elapsed && <span className="font-mono text-[0.6875rem] tabular-nums">{elapsed}</span>}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="pt-1.5">
          {parts.map((part, index) => (
            <CallRow key={part.toolCallId} part={part} last={index === parts.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}
