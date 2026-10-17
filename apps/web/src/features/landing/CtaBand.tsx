import { Seal } from "@hako/brand/react";

import { CopyCommand } from "@/components/common/CopyCommand";
import { SKILL_COMMAND } from "@/lib/constants/site";

/** The accent band: the big white mark top-right, one sentence, the skill command on white (Monid). */
export function CtaBand() {
  return (
    <section className="relative overflow-hidden bg-brand text-primary-foreground">
      <Seal className="absolute top-10 right-[6%] hidden size-32 text-primary-foreground/95 xl:block" label={null} />
      <div className="relative mx-auto flex max-w-[1100px] flex-col items-center px-4 py-28 text-center sm:px-6">
        <h2 className="display max-w-[820px] text-[clamp(2.2rem,5vw,3.6rem)]">Let your agent find the tools for you.</h2>
        <p className="mt-4 text-lg text-primary-foreground/80">Discover and inspect are free. Runs start at $0.001.</p>
        <CopyCommand command={SKILL_COMMAND} className="mt-9 max-w-[440px] bg-background text-foreground [&_span]:text-muted-foreground" />
      </div>
    </section>
  );
}
