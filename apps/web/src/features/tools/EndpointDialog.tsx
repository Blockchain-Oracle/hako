"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { CopyCommand } from "@/components/common/CopyCommand";
import { ProviderLogo } from "@/components/common/ProviderLogo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { endpointPrompt, formatPrice } from "@/lib/catalog/format";
import type { CatalogEndpoint } from "@/lib/catalog/types";
import { AGENT_MARKS } from "@/lib/constants/landing";
import { PAYMENT_NETWORK } from "@/lib/constants/onchain";
import { paidRunUrl, SKILL_URL } from "@/lib/constants/site";

interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  anyOf?: Array<{ type?: string }>;
}

function typeOf(prop: SchemaProperty): string {
  if (prop.enum) return prop.enum.map(String).join(" | ");
  if (prop.type) return prop.type;
  return (prop.anyOf ?? []).map((p) => p.type).filter((t) => t && t !== "null").join(" | ") || "any";
}

/** One endpoint's contract (what `inspect` returns), the prompt to give an agent, and the paid run URL. */
export function EndpointDialog({ endpoint, onClose }: { endpoint: CatalogEndpoint | null; onClose: () => void }) {
  const props = (endpoint?.input.properties ?? {}) as Record<string, SchemaProperty>;
  const required = new Set((endpoint?.input.required as string[] | undefined) ?? []);
  return (
    <Dialog open={endpoint !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto rounded-lg p-0 sm:max-w-[640px]">
        {endpoint && (
          <div className="p-6">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ProviderLogo id={endpoint.provider} name={endpoint.providerName} size="sm" /> {endpoint.providerName}
              <span className="rounded-sm bg-brand/[0.07] px-1.5 py-0.5 font-mono text-[0.625rem] tracking-[0.08em] text-brand uppercase">
                Live
              </span>
            </p>
            <DialogTitle className="mt-3 font-display text-2xl font-semibold tracking-[-0.03em]">
              {endpoint.displayName}
            </DialogTitle>
            <p className="mt-3 rounded-sm bg-muted px-3 py-2 font-mono text-xs text-ink-2">
              POST {paidRunUrl(endpoint.path)}
            </p>
            <DialogDescription className="mt-4 text-[0.9375rem] leading-relaxed text-ink-2">
              {endpoint.description}
            </DialogDescription>
            <p className="mt-4 font-mono">
              <span className="text-lg font-semibold">{formatPrice(endpoint.price.usd)}</span>{" "}
              <span className="text-xs text-muted-foreground">per call · USDC on {PAYMENT_NETWORK.label} from your PayBox wallet · not charged on failure</span>
            </p>

            <div className="mt-6 flex items-center gap-2 text-sm font-medium">
              Use it with your agent
              <span className="flex gap-1.5">
                {AGENT_MARKS.map((m) => (
                  <Image key={m.src} src={m.src} alt="" width={13} height={13} className="opacity-60" />
                ))}
              </span>
            </div>
            <CopyCommand command={endpointPrompt(SKILL_URL, endpoint)} wrap className="mt-2 shadow-none" />

            {Object.keys(props).length > 0 && (
              <section className="mt-7">
                <h3 className="font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">Input</h3>
                <dl className="mt-3 divide-y divide-line rounded-md border border-line">
                  {Object.entries(props).map(([name, prop]) => (
                    <div key={name} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-3 px-3 py-2.5 text-sm">
                      <dt className="font-mono text-[0.8125rem]">
                        {name}
                        {required.has(name) && <span className="text-brand">*</span>}
                        <span className="block text-[0.6875rem] text-muted-foreground">{typeOf(prop)}</span>
                      </dt>
                      <dd className="text-ink-2">{prop.description ?? ""}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className="mt-6">
              <h3 className="font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">Example body</h3>
              <pre className="mt-3 overflow-x-auto rounded-md bg-dark p-4 font-mono text-xs text-white">
                {JSON.stringify(endpoint.example, null, 2)}
              </pre>
            </section>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <ul className="flex flex-wrap gap-1.5">
                {endpoint.categories.map((c) => (
                  <li key={c} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2">
                    {c}
                  </li>
                ))}
              </ul>
              <Link
                href={`/agent?tool=${encodeURIComponent(endpoint.id)}`}
                className="inline-flex h-10 items-center gap-1.5 rounded-md bg-dark px-4 text-sm font-medium text-white hover:bg-dark-2"
              >
                Try it in the agent <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
