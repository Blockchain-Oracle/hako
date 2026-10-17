import { Seal } from "@hako/brand/react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { getCatalog } from "@/lib/catalog/catalog.server";
import { docsPage } from "@/lib/constants/site";

const WAYS_BACK = [
  { title: "Ask the agent", body: "Find the right tool for free; paid runs use your PayBox wallet.", href: "/agent" },
  { title: "Browse the tools", body: "Every tool with its price and example.", href: "/tools" },
  { title: "Read the docs", body: "Quickstarts, the API, MCP and the CLI.", href: docsPage() },
] as const;

export const metadata: Metadata = { title: "Page not found" };

/** The 404: the seal, one line, and three ways back in. */
export default async function NotFound() {
  const catalog = await getCatalog();
  const tools = catalog.endpoints.filter((e) => e.available).length;
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex max-w-[760px] flex-col items-center px-4 py-28 text-center">
        <Seal className="size-14 text-brand" label={null} />
        <p className="mt-8 font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">404 · page not found</p>
        <h1 className="display mt-3 text-[clamp(2.4rem,6vw,3.5rem)]">Nothing here.</h1>
        <p className="mt-4 text-lg text-muted-foreground">This page isn&apos;t part of Hako. Try one of these instead.</p>
        <div className="mt-10 grid w-full gap-3 text-left sm:grid-cols-3">
          {WAYS_BACK.map((way) => (
            <Link
              key={way.href}
              href={way.href}
              className="rounded-lg border border-line bg-background p-4 transition-colors hover:bg-muted"
            >
              <span className="block font-medium text-foreground">{way.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{way.body}</span>
            </Link>
          ))}
        </div>
        <Link href="/" className="mt-8 text-sm text-brand underline-offset-4 hover:underline">
          Back to the home page
        </Link>
      </main>
      <SiteFooter toolCount={tools} />
    </>
  );
}
