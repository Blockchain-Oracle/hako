import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { BecomeProvider, Connect, CtaBand, Faq, Hero, NoSubscriptions, Steps } from "@/features/landing";
import { getCatalog } from "@/lib/catalog/catalog.server";

// Rendered per request: the catalog comes from the live api (its fetch is cached for CATALOG_REVALIDATE_S), never
// from whatever the api answered at image build time.
export const dynamic = "force-dynamic";


export default async function Home() {
  const catalog = await getCatalog();
  return (
    <>
      <SiteHeader active="Home" />
      <main id="main">
        <Hero catalog={catalog} />
        <Steps />
        <NoSubscriptions catalog={catalog} />
        <Connect />
        <CtaBand />
        <Faq />
        <BecomeProvider />
      </main>
      <SiteFooter toolCount={catalog.endpoints.filter((e) => e.available).length} />
    </>
  );
}
