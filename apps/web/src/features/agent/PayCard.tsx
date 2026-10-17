"use client";

import { ArrowUpRight } from "lucide-react";

import { ProviderLogo } from "@/components/common/ProviderLogo";
import type { RunProposal } from "@/lib/agent/schemas";
import { formatPrice } from "@/lib/catalog/format";
import { PAYMENT_NETWORK } from "@/lib/constants/onchain";
import { PAYBOX_URL, SKILL_URL } from "@/lib/constants/site";

import { useEndpoint } from "./endpoints-context";

/**
 * The run the agent proposed: the tool, its provider, its input and its exact price. Paid runs are paid per call in
 * USDC on Base from the user's own PayBox wallet; this chat cannot connect PayBox yet, so the card says so in words
 * and offers no pay button: nothing was run and nothing was charged.
 */
export function PayCard({ input, proposal }: { input: Record<string, unknown>; proposal: RunProposal }) {
  const endpoint = useEndpoint(proposal.id);
  if (!endpoint || proposal.reason === "unknown_tool") {
    return <p className="text-sm text-muted-foreground">The agent asked for an unknown tool ({proposal.id}); nothing to pay.</p>;
  }
  const rows: Array<[string, string]> = [
    ["Paid with", "Your PayBox wallet"],
    ["Network", `USDC on ${PAYMENT_NETWORK.label}`],
    ["PayBox", "Not connected"],
  ];

  return (
    <div className="w-full max-w-[520px] overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <span className="font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
          Payment required · x402
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden /> {PAYMENT_NETWORK.label}
        </span>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <ProviderLogo id={endpoint.provider} name={endpoint.providerName} size="md" />
          <div className="min-w-0">
            <p className="font-semibold">{endpoint.displayName}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {endpoint.providerName} · {endpoint.id}
            </p>
          </div>
          <p className="ml-auto text-right">
            <span className="block font-mono text-lg font-semibold">{formatPrice(endpoint.price.usd)}</span>
            <span className="font-mono text-[0.6875rem] text-muted-foreground">USDC per call</span>
          </p>
        </div>
        <pre className="max-h-40 overflow-auto rounded-sm bg-card p-3 font-mono text-[0.75rem] text-muted-foreground">
          {JSON.stringify(input.input ?? {}, null, 2)}
        </pre>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[0.75rem]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-muted-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">
          Paid runs are paid from your PayBox wallet. Connecting PayBox to this chat isn&apos;t available yet, so this
          run was not made and nothing was charged.
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href={PAYBOX_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link underline-offset-4 hover:underline">
            Get PayBox <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
          <a href={SKILL_URL} className="text-link underline-offset-4 hover:underline">
            Run it from your own agent with PayBox
          </a>
        </p>
      </div>
    </div>
  );
}
