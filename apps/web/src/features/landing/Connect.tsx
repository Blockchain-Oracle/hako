import { ChevronRight } from "lucide-react";

import { CONNECT_WAYS } from "@/lib/constants/landing";

/** "Three ways to connect": left-aligned heading, three quiet cards with a chevron (Monid). */
export function Connect() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
      <h2 className="display text-[clamp(2.2rem,5vw,3.6rem)]">Three ways to connect.</h2>
      <p className="mt-4 text-lg text-muted-foreground">Same catalog, same wallet, whichever your agent speaks.</p>
      <ul className="mt-10 grid gap-4 md:grid-cols-3">
        {CONNECT_WAYS.map((way) => (
          <li key={way.title}>
            <a
              href={way.href}
              className="group flex h-full flex-col rounded-md border border-line bg-background p-6 shadow-card transition-shadow hover:shadow-card-hover"
            >
              <span className="flex items-center justify-between text-lg font-semibold">
                {way.title}
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
              <span className="mt-3 text-[0.9375rem] text-muted-foreground">{way.body}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
