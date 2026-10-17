import { publicEnv } from "../env"; // relative: next.config.ts imports this file, and aliases do not resolve there

export const SITE_NAME = "Hako";
export const SITE_URL = publicEnv.NEXT_PUBLIC_APP_URL;
export const DOCS_URL = publicEnv.NEXT_PUBLIC_DOCS_URL;
/** The public gateway agents call (free reads + x402-paid /v2 runs). */
export const GATEWAY_URL = publicEnv.NEXT_PUBLIC_API_URL;
/** A page of the documentation (the docs host serves its landing at / and the pages under /docs). */
export const docsPage = (path = "") => `${DOCS_URL}/docs${path && `/${path}`}`;
export const REPO_URL = "https://github.com/Blockchain-Oracle/hako";
export const SKILL_URL = `${SITE_URL}/SKILL.md`;
export const SKILL_COMMAND = `set up ${SKILL_URL}`;
/** Paid runs are paid from the user's PayBox wallet; Hako holds no wallet of its own. */
export const PAYBOX_URL = "https://paybox.sh";
export const PAYBOX_CONNECT_DOCS_URL = "https://docs.paybox.sh/connect/mcp";
/** The paid route for one catalog tool: the catalog keys tools by their /v1 path, /v2 serves the same tool on Base. */
export const RUN_V1_PREFIX = "/v1/run/";
export const RUN_V2_PREFIX = "/v2/run/";
export const paidRunUrl = (catalogPath: string) => `${GATEWAY_URL}${catalogPath.replace(RUN_V1_PREFIX, RUN_V2_PREFIX)}`;
export const X402_URL = "https://www.x402.org";
export const THEME_STORAGE_KEY = "hako-theme";

export const NAV = [
  { label: "Home", href: "/" },
  { label: "Tools", href: "/tools" },
  { label: "Agent", href: "/agent" },
  { label: "Docs", href: DOCS_URL },
] as const;

/** Catalog reads are revalidated this often (seconds): the catalog only changes on deploy, health every run. */
export const CATALOG_REVALIDATE_S = 300;
