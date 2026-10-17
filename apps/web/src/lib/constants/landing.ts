import { DOCS_URL, GATEWAY_URL, PAYBOX_URL, REPO_URL, SKILL_URL, X402_URL, docsPage } from "./site";

/** Agents shown under "Give this to your agent" (Simple Icons, CC0; nominative use). */
export const AGENT_MARKS = [
  { src: "/agents/claude.svg", label: "Claude" },
  { src: "/agents/openai.svg", label: "ChatGPT / Codex" },
  { src: "/agents/googlegemini.svg", label: "Gemini" },
  { src: "/agents/cursor.svg", label: "Cursor" },
  { src: "/agents/githubcopilot.svg", label: "GitHub Copilot" },
] as const;

/** How many tool tiles the hero grid shows before the "See all" tile (Monid: 24). */
export const HERO_TILE_COUNT = 24;
export const HERO_GRID_COLUMNS = 5;
/** Hero tile order: the names agents and judges recognise first, then everything else alphabetically. */
export const HERO_PROVIDER_ORDER = [
  "firecrawl", "serper", "groq", "jina", "hako", "wikipedia", "github", "openweather", "openalex", "arxiv",
  "hackernews", "npm", "pypi", "crossref", "wikidata", "ipinfo", "youtube", "nasa", "usgs", "pubchem",
  "worldbank", "frankfurter", "defillama", "openfoodfacts", "dictionary", "datamuse", "openlibrary", "depsdev",
  "wayback",
] as const;

export const STEPS = [
  {
    title: "Discover & compare",
    code: "hako.discover()",
    lines: ["candidates ranked", "by fit, health & price"],
    icon: "search",
  },
  {
    title: "Run the tool",
    code: "hako.run()",
    lines: ["use it right away", "no provider sign-ups or keys"],
    icon: "play",
  },
  {
    title: "Pay per call",
    code: "$0.005",
    lines: ["USDC on Base over x402,", "from your PayBox wallet"],
    icon: "wallet",
  },
] as const;

export const CONNECT_WAYS = [
  { title: "Skill", body: "One line into your agent's chat.", href: docsPage("quickstart/skill") },
  { title: "MCP", body: "Add the Hako MCP server.", href: docsPage("quickstart/mcp") },
  { title: "CLI", body: "Install and run from your terminal.", href: docsPage("quickstart/cli") },
] as const;

/** An example session, labelled as one: what an agent types and what Hako answers. Tool ids, inputs and prices are
 * real catalog entries; health and timings are typical values, not live readings. */
export const TERMINAL_SCRIPT = {
  path: "example session · ~/agents/research-bot",
  balance: "3.000",
  prompt: "find the latest papers on RAG hallucination and summarise what they agree on",
  steps: [
    { kind: "call", text: 'hako_discover("research papers rag hallucination")' },
    { kind: "result", text: "1. firecrawl/research-papers      $0.005/call   healthy 2.2s" },
    { kind: "result", text: "2. openalex/works                 $0.001/call   healthy 0.9s" },
    { kind: "result", text: "3. arxiv/search                   $0.001/call   stable  1.4s" },
    { kind: "call", text: 'hako_run("firecrawl/research-papers", {"query": "rag hallucination", "k": 5})' },
    { kind: "paid", text: "✓ 5 papers · paid $0.005 USDC from PayBox", meta: "$0.005" },
    { kind: "call", text: 'hako_run("groq/summarize", {"text": "…5 abstracts…"})' },
    { kind: "paid", text: "✓ summary with 4 agreed findings · paid $0.005", meta: "$0.005" },
  ],
} as const;

export const STATS = [
  { value: "tools", label: "Tools across {providers} providers" },
  { value: "per call", label: "Pay only for the calls your agent makes" },
  { value: "1 wallet", label: "For every tool, every provider" },
] as const;

export const FAQ = [
  {
    q: "Do I need API keys for each provider?",
    a: "No. Hako holds the provider keys (or uses keyless public APIs) and your agent pays per call in USDC on Base from your PayBox wallet. Payment is the credential: no provider accounts, no keys, no subscriptions.",
  },
  {
    q: "How is pricing structured?",
    a: "Every tool has one price per call, shown before you pay: $0.001 for keyless and local tools, $0.005 for standard keyed tools, $0.01 for premium ones such as live search with page content or cited answers. Discover and inspect are free.",
  },
  {
    q: "A provider failed. Do I get charged?",
    a: "No. The x402 payment is only settled after a tool returns a result. A provider error, a time-out or a lookup that finds nothing completes without settling, so your wallet is never debited for it.",
  },
  {
    q: "How does my agent pay?",
    a: "With your PayBox wallet. Every paid run is an x402 payment in USDC on Base: your agent calls PayBox's use_service on the tool's /v2/run URL. The Hako PayBox plugin is being built; once it is submitted for review, it is installable privately under Unofficial plugins by its owner only. Hako never holds a key or pays on your behalf. Discover and inspect are free and need no wallet.",
  },
  {
    q: "Which agent frameworks are supported?",
    a: "Anything that can read a skill file, speak MCP or call HTTP: Claude Code, Codex, Cursor, ChatGPT, LangChain, the Vercel AI SDK, or a curl loop. The CLI and the MCP servers discover and inspect tools for free; paid runs go through your PayBox wallet.",
  },
  {
    q: "What about rate limits?",
    a: "Hako caches answers and rate-limits its calls to each provider, so a burst on a free provider may be slower or answer 429. Each tool reports its health (healthy, stable, degraded) and typical run time from Hako's own runs, so your agent can pick a faster or cheaper alternative.",
  },
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
