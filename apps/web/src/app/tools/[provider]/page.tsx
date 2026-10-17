import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CopyCommand } from "@/components/common/CopyCommand";
import { ProviderLogo } from "@/components/common/ProviderLogo";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { EndpointGrid } from "@/features/tools/EndpointGrid";
import { getCatalog, getProvider } from "@/lib/catalog/catalog.server";
import { providerPrompt } from "@/lib/catalog/format";
import { AGENT_MARKS } from "@/lib/constants/landing";
import { SKILL_URL } from "@/lib/constants/site";

type Props = { params: Promise<{ provider: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await getProvider((await params).provider);
  return found ? { title: `${found.provider.displayName} APIs`, description: found.provider.summary } : {};
}

export default async function ProviderPage({ params }: Props) {
  const id = (await params).provider;
  const [found, catalog] = await Promise.all([getProvider(id), getCatalog()]);
  if (!found) notFound();
  const { provider, endpoints } = found;
  const labels = new Map(catalog.categories.map((c) => [c.id, c.label]));
  const related = [...new Set(endpoints.flatMap((e) => e.categories))];
  return (
    <>
      <SiteHeader active="Tools" />
      <main id="main" className="mx-auto max-w-[1100px] px-4 py-12 sm:px-6">
        <Link href="/tools" className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> Back to all tools
        </Link>
        <div className="mt-8">
          <p className="inline-flex rounded-full border border-line px-3 py-1 font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
            {endpoints.length} endpoint{endpoints.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <ProviderLogo id={provider.id} name={provider.displayName} size="lg" />
          <h1 className="display text-[clamp(2.4rem,5vw,3.4rem)]">{provider.displayName}</h1>
          <span className="flex items-center gap-3 text-sm text-muted-foreground">
            <a href={provider.homepage} className="inline-flex items-center gap-0.5 hover:text-foreground">
              Website <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
            {provider.docsUrl && (
              <a href={provider.docsUrl} className="inline-flex items-center gap-0.5 hover:text-foreground">
                Docs <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            )}
          </span>
        </div>
        <p className="mt-4 max-w-[640px] text-lg text-ink-2">{provider.summary}</p>
        {provider.attribution && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Data: {provider.attribution}
            {provider.licence ? ` · ${provider.licence}` : ""}
          </p>
        )}
        <div className="mt-8 flex items-center gap-3 font-mono text-xs text-muted-foreground">
          Get started by giving this to your agent
          <span className="flex gap-1.5">
            {AGENT_MARKS.map((m) => (
              <Image key={m.src} src={m.src} alt="" width={14} height={14} className="opacity-60" />
            ))}
          </span>
        </div>
        <CopyCommand command={providerPrompt(SKILL_URL, provider.displayName)} wrap className="mt-3 max-w-[560px]" />
        <EndpointGrid endpoints={endpoints} />
        {related.length > 0 && (
          <section className="mt-16">
            <h2 className="text-lg font-semibold">Related categories</h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {related.map((c) => (
                <li key={c}>
                  <Link href={`/tools?category=${c}`} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-subtle">
                    {labels.get(c) ?? c}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter toolCount={catalog.endpoints.filter((e) => e.available).length} />
    </>
  );
}
