import { getCatalog } from "@/lib/catalog/catalog.server";
import { PAYMENT_NETWORK } from "@/lib/constants/onchain";
import { CATALOG_REVALIDATE_S, DOCS_URL, GATEWAY_URL, RUN_V2_PREFIX, SITE_URL } from "@/lib/constants/site";

export const dynamic = "force-dynamic";

/** llms.txt: what Hako is and every tool, one line each (generated from the live catalog). */
export async function GET() {
  const catalog = await getCatalog();
  const lines = catalog.endpoints
    .filter((e) => e.available)
    .map((e) => `- ${e.id} ($${e.price.usd}/call): ${e.summary}`);
  const body = `# Hako

> 80+ paid tools for agents. Discover and inspect are free; runs are paid per call in USDC on ${PAYMENT_NETWORK.label}
> (x402) with your PayBox wallet. Skill: ${SITE_URL}/SKILL.md · Docs: ${DOCS_URL}/docs

- Discover: POST ${GATEWAY_URL}/v1/discover {"query": "..."}
- Inspect: POST ${GATEWAY_URL}/v1/inspect {"id": "provider/endpoint"}
- Run: POST ${GATEWAY_URL}${RUN_V2_PREFIX}{provider}/{endpoint} (x402, USDC on ${PAYMENT_NETWORK.label} \`${PAYMENT_NETWORK.id}\`; pay it with PayBox's use_service)
- Catalog: GET ${GATEWAY_URL}/v1/catalog (refreshed every ${CATALOG_REVALIDATE_S} s)

## Tools

${lines.join("\n")}
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
