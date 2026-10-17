import type { Metadata } from "next";

import { AgentApp, chatEndpoints } from "@/features/agent";

// Rendered per request: the catalog comes from the live api (its fetch is cached for CATALOG_REVALIDATE_S), never
// from whatever the api answered at image build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent",
  description: "Chat with an agent that finds tools for free and prices each run; paid runs use your PayBox wallet.",
};

/** `/agent?tool=<provider/endpoint>` (a tool page's "Try it in the agent") starts the composer with that tool. */
export default async function AgentPage({ searchParams }: { searchParams: Promise<{ tool?: string | string[] }> }) {
  const endpoints = await chatEndpoints();
  const { tool } = await searchParams;
  const id = typeof tool === "string" && tool in endpoints ? tool : undefined;
  return <AgentApp endpoints={endpoints} initialInput={id ? `Use ${id} to ` : undefined} />;
}
