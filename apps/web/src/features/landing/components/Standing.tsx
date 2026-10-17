import { STANDING, STATE_LABEL, type StandingState } from "../lib/content";

/** A state in words and shape: a filled dot for live, a hollow ring for being built (never colour alone). */
function StateTag({ state }: { state: StandingState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <span
        className={state === "live" ? "size-2 rounded-full bg-success" : "size-2 rounded-full ring-[1.5px] ring-muted-foreground ring-inset"}
        aria-hidden
      />
      {STATE_LABEL[state]}
    </span>
  );
}

/** "Where Hako stands": what works today and what is being built, on quiet card plates (depth by fill, no borders). */
export function Standing({ tools }: { tools: number }) {
  return (
    <section aria-labelledby="standing" className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
      <h2 id="standing" className="type-page-title text-foreground">
        Where Hako stands
      </h2>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STANDING(tools).map((row) => (
          <li key={row.title} className="rounded-lg bg-card p-5">
            <StateTag state={row.state} />
            <p className="mt-3 font-semibold text-foreground">{row.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{row.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
