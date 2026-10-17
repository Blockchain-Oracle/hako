import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { Hero, Standing } from "@/features/landing";
import { getCatalog } from "@/lib/catalog/catalog.server";

// Rendered per request: the catalog comes from the live api (its fetch is cached for CATALOG_REVALIDATE_S), never
// from whatever the api answered at image build time.
export const dynamic = "force-dynamic";

/** The Hako landing shell (W0.4): the promise, the live tool count and where Hako stands. L6 finishes it. */
export default async function Home() {
  const catalog = await getCatalog();
  const tools = catalog.endpoints.filter((e) => e.available).length;
  return (
    <>
      <SiteHeader active="Home" />
      <main id="main">
        <Hero tools={tools} />
        <Standing tools={tools} />
      </main>
      <SiteFooter toolCount={tools} />
    </>
  );
}
