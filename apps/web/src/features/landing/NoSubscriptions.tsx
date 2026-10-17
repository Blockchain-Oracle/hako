import type { Catalog } from "@/lib/catalog/types";

import { Terminal } from "./Terminal";

/** Monid's "We killed the subscriptions" section: three big accent stats, then the live terminal window. */
export function NoSubscriptions({ catalog }: { catalog: Catalog }) {
  const tools = catalog.endpoints.filter((e) => e.available).length;
  const providers = catalog.providers.filter((p) => p.available).length;
  const stats = [
    { value: `${tools}`, label: `Tools across ${providers} providers` },
    { value: "per call", label: "Pay only for the calls your agent makes" },
    { value: "1 wallet", label: "For every tool, every provider" },
  ];
  return (
    <section className="mx-auto max-w-[1100px] px-4 py-24 text-center sm:px-6">
      <h2 className="display text-[clamp(2.2rem,5vw,3.6rem)]">No API keys. No subscriptions.</h2>
      <p className="mt-4 text-lg text-muted-foreground">Your agent pays for every tool from one PayBox wallet.</p>
      <dl className="mt-14 grid gap-10 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd className="font-display text-[clamp(2.4rem,4.6vw,3.4rem)] leading-none font-semibold tracking-[-0.04em] text-brand">
              {stat.value}
            </dd>
            <dd className="mt-3 text-[0.9375rem] text-muted-foreground">{stat.label}</dd>
          </div>
        ))}
      </dl>
      <Terminal />
    </section>
  );
}
