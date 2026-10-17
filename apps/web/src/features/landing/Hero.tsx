import Image from "next/image";

import { CopyCommand } from "@/components/common/CopyCommand";
import { AGENT_MARKS } from "@/lib/constants/landing";
import { SKILL_COMMAND } from "@/lib/constants/site";
import type { Catalog } from "@/lib/catalog/types";

import { ToolHub } from "./ToolHub";

/** Monid's hero: live pill, two-line Outfit headline with one accent phrase, the skill command, then the hub. */
export function Hero({ catalog }: { catalog: Catalog }) {
  const live = catalog.endpoints.filter((e) => e.available).length;
  return (
    <section className="relative overflow-hidden">
      <div className="char-field pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 pt-16 text-center sm:px-6 sm:pt-24">
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-background px-3.5 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase shadow-card">
          <span className="size-1.5 rounded-full bg-success" aria-hidden /> Live · {live} tools · paid with PayBox
        </p>
        <h1 className="display mt-7 text-[clamp(2.6rem,6.2vw,4.2rem)] text-foreground">
          One endpoint.
          <br />
          <span className="text-brand">Every tool</span> your agent needs.
        </h1>
        <div className="mt-9 flex items-center gap-3 text-lg text-ink-2">
          <span>Give this to your agent</span>
          <span className="flex items-center gap-2" aria-label={AGENT_MARKS.map((m) => m.label).join(", ")}>
            {AGENT_MARKS.map((mark) => (
              <Image key={mark.src} src={mark.src} alt="" width={20} height={20} className="opacity-70 dark:invert" />
            ))}
          </span>
        </div>
        <CopyCommand command={SKILL_COMMAND} className="mt-5 max-w-[440px]" />
        <p className="mt-6 text-lg text-ink-2">and let it take it from there.</p>
      </div>
      <ToolHub catalog={catalog} />
    </section>
  );
}
