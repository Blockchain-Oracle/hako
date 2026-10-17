import { PRODUCTION_API_URL, PRODUCTION_APP_URL } from "@/lib/constants/urls";
import { site } from "@/lib/site";

/** The parts of an mdast / MDX node that can hold a URL: text and code values, link targets, JSX attributes. */
interface UrlNode {
  value?: unknown;
  url?: unknown;
  attributes?: { value?: unknown }[];
  children?: UrlNode[];
}

const SWAPS = new Map<string, string>([
  [PRODUCTION_API_URL, site.api],
  [PRODUCTION_APP_URL, site.app],
]);
for (const [from, to] of SWAPS) if (from === to) SWAPS.delete(from);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One pass, longest first, so a swapped-in URL is never swapped again.
const PATTERN = new RegExp([...SWAPS.keys()].sort((a, b) => b.length - a.length).map(escape).join("|"), "g");

function swap(text: string): string {
  return text.replace(PATTERN, (match) => SWAPS.get(match) ?? match);
}

function visit(node: UrlNode): void {
  if (typeof node.value === "string") node.value = swap(node.value);
  if (typeof node.url === "string") node.url = swap(node.url);
  for (const attribute of node.attributes ?? []) {
    if (typeof attribute.value === "string") attribute.value = swap(attribute.value);
  }
  node.children?.forEach(visit);
}

/**
 * Pages are written with the production URLs (readable, and right for production builds). This remark plugin
 * rewrites them to the URLs this build was configured with, in prose, links and code blocks alike.
 */
export function remarkSiteUrls() {
  return (tree: UrlNode) => {
    if (SWAPS.size > 0) visit(tree);
  };
}
