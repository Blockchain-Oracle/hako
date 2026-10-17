import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { BecomeProvider } from "@/features/landing/BecomeProvider";
import { Connect } from "@/features/landing/Connect";
import { CtaBand } from "@/features/landing/CtaBand";
import { Faq } from "@/features/landing/Faq";
import { Hero } from "@/features/landing/Hero";
import { NoSubscriptions } from "@/features/landing/NoSubscriptions";
import { Steps } from "@/features/landing/Steps";
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
