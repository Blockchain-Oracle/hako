import { GitHubMark } from "@/components/common/GitHubMark";
import { REPO_URL } from "@/lib/constants/site";

/** "Become a tool provider": a soft grey card with one accent button (Monid). */
export function BecomeProvider() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
      <div className="flex flex-col items-center rounded-lg bg-muted px-6 py-16 text-center">
        <h2 className="display text-[clamp(2rem,4.4vw,3.1rem)]">Become a tool provider.</h2>
        <p className="mt-4 max-w-[600px] text-lg text-muted-foreground">
          Hako is open source. Describe your API as a connector, one provider file and one typed handler per
          endpoint, and it shows up in discover for every agent using Hako.
        </p>
        <a
          href={`${REPO_URL}/blob/main/packages/tools/CONNECTORS.md`}
          className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-brand px-5 text-[0.9375rem] font-medium text-primary-foreground transition-colors hover:bg-brand-hover active:bg-brand-press"
        >
          <GitHubMark className="size-4" /> Contribute on GitHub →
        </a>
      </div>
    </section>
  );
}
