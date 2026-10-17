import { NETWORK_KEYS, NETWORKS, canonicalCaip2, type Network, type NetworkKey, type TokenInfo } from "@hako/networks";

/**
 * The entities Hako shows with their real artwork (Kawase's identity registry, keyed for Hako). Chains by CAIP-2
 * (`chain:eip155:8453`, `chain:solana:mainnet`), tokens by CAIP-2 + address (lowercase on EVM, as published on
 * Solana), catalog providers by their catalog id (`provider:open-meteo`), LI.FI routes by tool key (`venue:across`).
 * Chain ids and addresses come from @hako/networks so the registry cannot drift from the verified values. Each file in
 * svg/ has a row in PROVENANCE.md; an entity whose artwork has not been delivered renders the labelled neutral disc,
 * never a stand-in.
 */
export type EntityKind = "chain" | "token" | "provider" | "venue" | "fiat";

export type MarkVariant = "color" | "mono";

export type Entity = {
  id: string;
  kind: EntityKind;
  name: string;
  /** Short label for chips and the neutral disc (USDC, ETH); chains use their name. */
  symbol?: string;
  /** For chains and tokens: the CAIP-2 id. */
  caip2?: string;
  address?: string;
  decimals?: number;
  /** The brand's own colour as its artwork carries it (absent when no artwork has been delivered). */
  brandColor?: string;
  /** "disc" marks come as a full circle or are cropped to one; "tile" marks fill their box (a rounded square);
   * "uncontained" marks are a glyph that sits on a disc we draw. */
  shape: "disc" | "tile" | "uncontained";
  /** File stems in svg/ (without .svg) per variant; absent = not delivered yet. */
  marks: Partial<Record<MarkVariant, string>>;
};

export const chainKey = (caip2: string) => `chain:${canonicalCaip2(caip2) ?? caip2}`;
/** EVM addresses are case-insensitive (lowercased here); Solana mints are case-sensitive base58 (kept as given). */
export const tokenKey = (caip2: string, address: string) => {
  const chain = canonicalCaip2(caip2) ?? caip2;
  return `token:${chain}:${chain.startsWith("eip155:") ? address.toLowerCase() : address}`;
};
export const providerKey = (slug: string) => `provider:${slug}`;
/** A LI.FI bridge or exchange by its tool key (https://li.quest/v1/tools `key`). */
export const venueKey = (toolKey: string) => `venue:${toolKey}`;
/** A display currency by its ISO 4217 code ("fiat:NGN"): the issuing country's flag. */
export const fiatKey = (code: string) => `fiat:${code.toUpperCase()}`;

type Look = Pick<Entity, "brandColor" | "shape" | "marks">;

const CHAIN_LOOK: Record<NetworkKey, Look> = {
  base: { brandColor: "#0052FF", shape: "tile", marks: { color: "base", mono: "base-mono" } },
  ethereum: { brandColor: "#627EEA", shape: "uncontained", marks: { color: "ethereum", mono: "ethereum-mono" } },
  arbitrum: { brandColor: "#12AAFF", shape: "disc", marks: { color: "arbitrum", mono: "arbitrum-mono" } },
  optimism: { brandColor: "#FF0420", shape: "disc", marks: { color: "optimism", mono: "optimism-mono" } },
  polygon: { brandColor: "#8247E5", shape: "disc", marks: { color: "polygon", mono: "polygon-mono" } },
  solana: { brandColor: "#9945FF", shape: "uncontained", marks: { color: "solana", mono: "solana-mono" } },
};

/** Native coins by symbol: ETH on the four Ether chains, POL on Polygon, SOL on Solana. */
const NATIVE_LOOK: Record<string, Look> = {
  ETH: { brandColor: "#627EEA", shape: "disc", marks: { color: "eth", mono: "eth-mono" } },
  POL: { brandColor: "#8247E5", shape: "disc", marks: { color: "pol", mono: "pol-mono" } },
  SOL: { brandColor: "#9945FF", shape: "disc", marks: { color: "sol", mono: "sol-mono" } },
};
const USDC_LOOK: Look = { brandColor: "#2775CA", shape: "disc", marks: { color: "usdc", mono: "usdc-mono" } };

const token = (network: Network, info: TokenInfo, look: Look): Entity => ({
  id: tokenKey(network.caip2, info.address),
  kind: "token",
  name: info.name,
  symbol: info.symbol,
  caip2: network.caip2,
  address: info.address,
  decimals: info.decimals,
  ...look,
});

const NETWORK_ENTITIES: Entity[] = NETWORK_KEYS.flatMap((key) => {
  const network = NETWORKS[key];
  const native = NATIVE_LOOK[network.native.symbol];
  return [
    { id: chainKey(network.caip2), kind: "chain" as const, name: network.name, caip2: network.caip2, ...CHAIN_LOOK[key] },
    ...(native ? [token(network, network.native, native)] : []),
    token(network, network.usdc, USDC_LOOK),
  ];
});

const provider = (slug: string, name: string, look: Look): Entity => ({ id: providerKey(slug), kind: "provider", name, ...look });
const glyph = (brandColor: string | undefined, color: string | undefined, mono?: string): Look => ({
  ...(brandColor ? { brandColor } : {}),
  shape: "uncontained",
  marks: { ...(color ? { color } : {}), ...(mono ? { mono } : {}) },
});
const tile = (brandColor: string, color: string, mono?: string): Look => ({ brandColor, shape: "tile", marks: { color, ...(mono ? { mono } : {}) } });
const disc = (brandColor: string, color: string, mono?: string): Look => ({ brandColor, shape: "disc", marks: { color, ...(mono ? { mono } : {}) } });
/** Not delivered yet (PROVENANCE.md "Not delivered yet"): the labelled neutral disc. */
const NONE: Look = { shape: "uncontained", marks: {} };

/** Hako, the wallet and ramp it is built on, and the money rails it routes through. */
const PLATFORM: Entity[] = [
  provider("hako", "Hako", glyph("#000000", "hako", "hako-mono")),
  provider("paybox", "PayBox", glyph("#000000", "paybox", "paybox-mono")),
  provider("moonpay", "MoonPay", glyph("#7D00FF", "moonpay", "moonpay-mono")),
  provider("lifi", "LI.FI", tile("#F7C2FF", "lifi", "lifi-mono")),
  provider("circle", "Circle", glyph("#00E599", "circle", "circle-mono")),
  provider("coinbase", "Coinbase", tile("#0052FF", "coinbase", "coinbase-mono")),
];

/** Catalog providers by catalog id (packages/tools connectors; the C16 additions use the ids L2 registers). */
const CATALOG: Entity[] = [
  provider("arxiv", "arXiv", glyph("#B31B1B", "arxiv", "arxiv-mono")),
  provider("coingecko", "CoinGecko", NONE),
  provider("crossref", "Crossref", NONE),
  provider("datamuse", "Datamuse", NONE),
  provider("defillama", "DefiLlama", tile("#0062EE", "defillama")),
  provider("depsdev", "deps.dev", NONE),
  provider("dictionary", "Free Dictionary API", NONE),
  provider("firecrawl", "Firecrawl", glyph("#FA5D19", "firecrawl", "firecrawl-mono")),
  provider("frankfurter", "Frankfurter", glyph(undefined, undefined, "frankfurter-mono")),
  provider("github", "GitHub", glyph("#181717", "github", "github-mono")),
  provider("google-news", "Google News", glyph("#174EA6", "google-news", "google-news-mono")),
  provider("groq", "Groq", tile("#F43E01", "groq")),
  provider("hackernews", "Hacker News", tile("#F0652F", "hackernews", "hackernews-mono")),
  provider("ipinfo", "IPinfo", glyph("#3091CF", "ipinfo")),
  provider("jina", "Jina", NONE),
  provider("nasa", "NASA", glyph("#E03C31", "nasa", "nasa-mono")),
  provider("npm", "npm", tile("#CB3837", "npm", "npm-mono")),
  provider("openfoodfacts", "Open Food Facts", glyph(undefined, undefined, "openfoodfacts-mono")),
  provider("openlibrary", "Open Library", NONE),
  provider("open-meteo", "Open-Meteo", glyph(undefined, undefined, "open-meteo-mono")),
  provider("openalex", "OpenAlex", glyph(undefined, undefined, "openalex-mono")),
  provider("openstreetmap", "OpenStreetMap", glyph("#7EBC6F", "openstreetmap", "openstreetmap-mono")),
  provider("openweather", "OpenWeather", glyph("#EB6E4B", "openweather")),
  provider("pubchem", "PubChem", NONE),
  provider("pypi", "PyPI", glyph("#3775A9", "pypi", "pypi-mono")),
  provider("serper", "Serper", glyph(undefined, undefined, "serper-mono")),
  provider("usgs", "USGS Earthquakes", NONE),
  provider("wayback", "Wayback Machine", glyph("#666666", "wayback", "wayback-mono")),
  provider("wikidata", "Wikidata", glyph("#006699", "wikidata", "wikidata-mono")),
  provider("wikipedia", "Wikipedia", glyph("#000000", "wikipedia", "wikipedia-mono")),
  provider("worldbank", "World Bank Open Data", NONE),
  provider("youtube", "YouTube", glyph("#FF0000", "youtube", "youtube-mono")),
  // C16: the new catalog providers (plan §1 C16).
  provider("exa", "Exa", glyph("#0143D9", "exa", "exa-mono")),
  provider("artificial-analysis", "Artificial Analysis", glyph(undefined, undefined, "artificial-analysis-mono")),
  provider("elevenlabs", "ElevenLabs", glyph("#000000", "elevenlabs", "elevenlabs-mono")),
  provider("polymarket", "Polymarket", glyph(undefined, undefined, "polymarket-mono")),
  provider("jupiter", "Jupiter", disc("#00BEF0", "jupiter", "jupiter-mono")),
  provider("helius", "Helius", glyph("#E84125", "helius")),
];

/** LI.FI Earn protocols and the rewards layer its vaults report. */
const EARN: Entity[] = [
  provider("aave", "Aave", disc("#9391F7", "aave", "aave-mono")),
  provider("morpho", "Morpho", tile("#15181A", "morpho", "morpho-mono")),
  provider("aero", "Aero", glyph("#154AFA", "aero", "aero-mono")),
  provider("merkl", "Merkl", disc("#1F2333", "merkl")),
];

const venue = (toolKey: string, name: string, look: Look): Entity => ({ id: venueKey(toolKey), kind: "venue", name, ...look });

/** LI.FI routes by tool key (route race rows, receipts); every other tool shows LI.FI's own logoURI through the proxy. */
const VENUES: Entity[] = [
  venue("across", "Across", disc("#6CF9D8", "across", "across-mono")),
  venue("relaydepository", "Relay", tile("#4615C8", "relay", "relay-mono")),
  venue("cctp", "Circle CCTP", glyph("#00E599", "circle", "circle-mono")),
  venue("gasZipBridge", "Gas.zip", tile("#3A6EA5", "gaszip")),
  venue("kyberswap", "KyberSwap", disc("#31CB9E", "kyberswap", "kyberswap-mono")),
  venue("jupiter", "Jupiter", disc("#00BEF0", "jupiter", "jupiter-mono")),
  venue("lifidexaggregator", "LI.FI DEX Aggregator", tile("#F7C2FF", "lifi", "lifi-mono")),
  venue("lifiIntents", "LI.FI Intents", tile("#F7C2FF", "lifi", "lifi-mono")),
  venue("lifiIntentsDex", "LI.FI Intents", tile("#F7C2FF", "lifi", "lifi-mono")),
];

/** Display currencies (FX answers, balances in local money): the issuing country's flag, round (circle-flags, MIT). */
const CURRENCIES: [code: string, name: string, flag: string][] = [
  ["USD", "US Dollar", "us"], ["EUR", "Euro", "eu"], ["GBP", "British Pound", "gb"], ["NGN", "Nigerian Naira", "ng"],
  ["KES", "Kenyan Shilling", "ke"], ["GHS", "Ghanaian Cedi", "gh"], ["ZAR", "South African Rand", "za"],
  ["EGP", "Egyptian Pound", "eg"], ["INR", "Indian Rupee", "in"], ["PKR", "Pakistani Rupee", "pk"],
  ["BDT", "Bangladeshi Taka", "bd"], ["CNY", "Chinese Yuan", "cn"], ["JPY", "Japanese Yen", "jp"],
  ["KRW", "South Korean Won", "kr"], ["IDR", "Indonesian Rupiah", "id"], ["PHP", "Philippine Peso", "ph"],
  ["VND", "Vietnamese Dong", "vn"], ["SGD", "Singapore Dollar", "sg"], ["AED", "UAE Dirham", "ae"],
  ["SAR", "Saudi Riyal", "sa"], ["TRY", "Turkish Lira", "tr"], ["BRL", "Brazilian Real", "br"],
  ["MXN", "Mexican Peso", "mx"], ["ARS", "Argentine Peso", "ar"], ["COP", "Colombian Peso", "co"],
  ["CAD", "Canadian Dollar", "ca"], ["AUD", "Australian Dollar", "au"], ["CHF", "Swiss Franc", "ch"],
];
const FIAT: Entity[] = CURRENCIES.map(([code, name, flag]) => ({
  id: fiatKey(code),
  kind: "fiat",
  name,
  symbol: code,
  shape: "disc",
  marks: { color: `flag-${flag}` },
}));

export const ENTITIES: readonly Entity[] = [...NETWORK_ENTITIES, ...PLATFORM, ...CATALOG, ...EARN, ...VENUES, ...FIAT];
