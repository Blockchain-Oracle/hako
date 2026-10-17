import { DOCS_URL, GATEWAY_URL, PAYBOX_URL, REPO_URL, SKILL_URL, X402_URL } from "./site";

/** Agents shown under "Give this to your agent" (Simple Icons, CC0; nominative use). */
export const AGENT_MARKS = [
  { src: "/agents/claude.svg", label: "Claude" },
  { src: "/agents/openai.svg", label: "ChatGPT / Codex" },
  { src: "/agents/googlegemini.svg", label: "Gemini" },
  { src: "/agents/cursor.svg", label: "Cursor" },
  { src: "/agents/githubcopilot.svg", label: "GitHub Copilot" },
] as const;

export const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Home", href: "/" },
      { label: "Tools", href: "/tools" },
      { label: "Agent", href: "/agent" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: DOCS_URL },
      { label: "SKILL.md", href: SKILL_URL },
      { label: "Catalog JSON", href: `${GATEWAY_URL}/v1/catalog` },
    ],
  },
  {
    title: "Network",
    links: [
      { label: "PayBox", href: PAYBOX_URL },
      { label: "x402", href: X402_URL },
      { label: "GitHub", href: REPO_URL },
    ],
  },
] as const;
