import { HakoMark } from "@hako/brand/react";

import { SUGGESTIONS } from "@/lib/constants/agent";

/** The empty chat: the mark, one line, and starters that each reach a different part of the catalog. */
export function ChatHome({ onPick, toolCount }: { onPick: (prompt: string) => void; toolCount: number }) {
  return (
    <div className="flex flex-col items-center pt-10 text-center sm:pt-20">
      <HakoMark className="size-12 text-foreground" />
      <h1 className="display mt-6 text-[clamp(2rem,4.6vw,3rem)]">What should your agent find?</h1>
      <p className="mt-3 max-w-[520px] text-muted-foreground">
        It searches {toolCount} tools for free, picks one and shows you its price. Paid runs cost a fraction of a cent
        in USDC, paid from your PayBox wallet.
      </p>
      <ul className="mt-10 grid w-full max-w-[720px] gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={() => onPick(s.prompt)}
              className="flex h-full w-full flex-col rounded-md border border-border bg-background p-4 text-left transition-shadow"
            >
              <span className="text-sm font-semibold">{s.label}</span>
              <span className="mt-1 line-clamp-2 text-[0.8125rem] text-muted-foreground">{s.prompt}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
