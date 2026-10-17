import { HakoMark } from "@hako/brand/react";
import Link from "next/link";

import { docsRoute } from "@/lib/shared";
import { site } from "@/lib/site";

const START = [
  { title: "Introduction", body: "What Hako is and how a run works.", href: docsRoute },
  { title: "Quickstart", body: "Five ways to start, no install needed.", href: `${docsRoute}/quickstart` },
  { title: "Tools", body: "Every tool, its price and a working example.", href: `${docsRoute}/tools` },
] as const;

/** The docs' 404: the mark, one line, and three ways back in (search stays in the header). */
export function NotFoundPanel() {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <HakoMark className="size-14 text-fd-foreground" label={null} />
      <p className="mt-8 text-sm text-fd-muted-foreground">404 · page not found</p>
      <h1 className="mt-3 font-display text-4xl font-black tracking-[-0.02em] text-fd-foreground">
        This page isn&apos;t in the docs.
      </h1>
      <p className="mt-3 text-fd-muted-foreground">
        It may have moved. Search the docs, or start from one of these.
      </p>
      <div className="mt-10 grid w-full gap-3 text-left sm:grid-cols-3">
        {START.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg bg-fd-card p-4 transition-colors hover:bg-fd-accent"
          >
            <span className="block font-medium text-fd-foreground">{item.title}</span>
            <span className="mt-1 block text-sm text-fd-muted-foreground">{item.body}</span>
          </Link>
        ))}
      </div>
      <a href={site.app} className="mt-8 text-sm text-fd-primary underline-offset-4 hover:underline">
        Or open the app at usehako.xyz
      </a>
    </div>
  );
}
