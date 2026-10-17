import type { Metadata } from "next";

import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { ToolsBrowser } from "@/features/tools/ToolsBrowser";
import { getCatalog } from "@/lib/catalog/catalog.server";

// Rendered per request: the catalog comes from the live api (its fetch is cached for CATALOG_REVALIDATE_S), never
// from whatever the api answered at image build time.
export const dynamic = "force-dynamic";


export const metadata: Metadata = { title: "Tools", description: "Every tool your agent can call through Hako." };

export default async function ToolsPage() {
  const catalog = await getCatalog();
  const tools = catalog.endpoints.filter((e) => e.available).length;
  const providers = catalog.providers.filter((p) => p.available).length;
  return (
    <>
      <SiteHeader active="Tools" />
      <main id="main" className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
          <span className="size-1.5 rounded-full bg-success" aria-hidden /> {tools} tools · {providers} providers
        </p>
        <h1 className="display mt-6 text-[clamp(2.6rem,6vw,4rem)]">
          Every tool.
          <br />
          One wallet.
        </h1>
        <p className="mt-5 max-w-[560px] text-lg text-muted-foreground">
          The tools your agent calls. Live, metered and paid per call in USDC. No vendor portal, no API keys, no
          subscription cliff.
        </p>
        <ToolsBrowser catalog={catalog} />
      </main>
      <SiteFooter toolCount={tools} />
    </>
  );
}
