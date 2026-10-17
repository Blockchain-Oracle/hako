import { Play, Search, Wallet } from "lucide-react";

import { STEPS } from "@/lib/constants/landing";

const ICONS = { search: Search, play: Play, wallet: Wallet } as const;

/** "Tell your agent what to do": the three verbs on a subtle band, joined by thin rules (Monid's step row). */
export function Steps() {
  return (
    <section className="border-y border-line bg-subtle">
      <div className="mx-auto max-w-[1100px] px-4 py-24 text-center sm:px-6">
        <h2 className="display mx-auto max-w-[720px] text-[clamp(2rem,4.4vw,3.1rem)]">
          Tell your agent what to do. It picks the tools itself.
        </h2>
        <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, index) => {
            const Icon = ICONS[step.icon];
            return (
              <li key={step.title} className="relative flex flex-col items-center">
                {index > 0 && (
                  <span className="absolute top-6 right-[calc(50%+3.5rem)] hidden h-px w-[calc(100%-7rem)] bg-line-default md:block" aria-hidden />
                )}
                <span className="flex size-12 items-center justify-center rounded-md border border-line bg-background text-brand shadow-card">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                <code className="mt-3 rounded-sm bg-brand/[0.06] px-2.5 py-1 font-mono text-[0.8125rem] text-brand">
                  {step.code}
                </code>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  {step.lines[0]}
                  <br />
                  {step.lines[1]}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
