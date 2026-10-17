import { Mark, providerKey } from "@hako/identity";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CopyCommand } from "@/components/common/CopyCommand";
import { SKILL_COMMAND } from "@/lib/constants/site";

import { BUILT_ON_MARK_SIZE } from "../landing.config";
import { BUILT_ON, HERO } from "../lib/content";

/**
 * The hero (Kawase landing grammar on Senryo tokens): a status line in words, the promise as the one title, black
 * primary action, a quiet secondary one, and the one line an agent needs. The tool count is the catalog's live count.
 */
export function Hero({ tools }: { tools: number }) {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
      <p className="inline-flex items-center gap-2 rounded-full bg-card px-3.5 py-1.5 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-success" aria-hidden />
        Live on Base · {tools} tools · paid with PayBox
      </p>
      <h1 className="display mt-7 max-w-[15ch] text-[clamp(2.75rem,7vw,4.5rem)] text-balance text-foreground">
        {HERO.title}
      </h1>
      <p className="mt-6 max-w-measure text-lg leading-relaxed text-muted-foreground">{HERO.promise(tools)}</p>
      <p className="mt-4 max-w-measure text-sm text-muted-foreground">{HERO.honesty}</p>
      <div className="mt-9 flex flex-wrap items-center gap-3">
        <Link
          href="/agent"
          className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 font-semibold text-primary-foreground transition-colors hover:bg-primary-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Try the agent <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link
          href="/tools"
          className="inline-flex h-12 items-center rounded-full bg-secondary px-6 font-semibold text-secondary-foreground transition-colors hover:bg-row-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Browse the tools
        </Link>
      </div>
      <div className="mt-10 max-w-[520px]">
        <p className="mb-2 text-sm text-muted-foreground">Give this to your agent</p>
        <CopyCommand command={SKILL_COMMAND} />
      </div>
      <p className="mt-10 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground">
        <span>{BUILT_ON.lead}</span>
        {BUILT_ON.partners.map((partner, i) => (
          <span key={partner.id} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground" aria-hidden>·</span>}
            <span aria-hidden className="inline-flex">
              <Mark entity={providerKey(partner.id)} size={BUILT_ON_MARK_SIZE} disc={false} />
            </span>
            {partner.name}
          </span>
        ))}
      </p>
    </section>
  );
}
