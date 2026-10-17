"""Tool-router constants. Every limit names the reason it has that value."""

from typing import Final

SERVICE_ID: Final = "tool-router"  # the service name in the catalog, the identity and the spec path
SERVICE_TITLE: Final = "Hako Tool Router"
CATALOG_VERSION: Final = 1
RUN_PATH_PREFIX: Final = "/v1/run"
# The gateway's paid route for the same tool: x402 in USDC, paid with PayBox use_service (the api runs nothing paid)
PAID_RUN_PREFIX: Final = "/v2/run"

# A PayBox plugin operation gets 10 s (developer.paybox.sh requirements); keep 1 s for the gateway hop +
# serialisation. Endpoints may ask for less, never more.
RUN_DEADLINE_DEFAULT_S: Final = 8.0
RUN_DEADLINE_MAX_S: Final = 9.0
CATALOG_ROUTE_DEADLINE_S: Final = 2.0  # discover / inspect / catalog are local reads

# Output caps: agents read the answer into a context window, and a scraped page can be 172 KB (measured on a
# Wikipedia article, 2026-10-07). Long strings are trimmed first, then lists, until the body fits.
MAX_OUTPUT_BYTES: Final = 60_000
MAX_TEXT_CHARS: Final = 20_000
MIN_TEXT_CHARS: Final = 500  # never trim one string below this while shrinking
TRUNCATION_MARK: Final = " …[truncated by Hako]"
SHRINK_FACTOR: Final = 0.6  # each shrink pass keeps 60% of the current text budget
MAX_SHRINK_PASSES: Final = 8

# USDC has 6 decimals: $0.005 = 5000 atomic units.
USDC_DECIMALS: Final = 6
# Free reads (chain lookups, market odds, Earn vaults): served by the gateway's free /v1 aliases and never sold on /v2
# (plan C17, B13), so they cost nothing anywhere.
PRICE_FREE_USD: Final = "0"
PRICE_LOCAL_USD: Final = "0.001"  # keyless upstreams and local compute
PRICE_STANDARD_USD: Final = "0.005"  # keyed upstream, cheap per call
PRICE_PREMIUM_USD: Final = "0.01"  # upstream cost ≥ $0.005 (Firecrawl search ≈ 2 credits, composites)
PAYMENT_NETWORK: Final = "eip155:8453"  # Base mainnet USDC: the gateway's paid /v2 route (x402 exact, CDP)

# Discover
DISCOVER_DEFAULT_LIMIT: Final = 8
DISCOVER_MAX_LIMIT: Final = 25
DISCOVER_MIN_TOKEN_CHARS: Final = 2
DISCOVER_PREFIX_MIN_CHARS: Final = 3  # tokens this long also match as a prefix ("scrap" → "scraping")
DISCOVER_QUERY_MAX_CHARS: Final = 500
# bm25() column weights, in FTS column order: name, summary, categories, provider, description.
DISCOVER_WEIGHTS: Final = (4.0, 3.0, 3.0, 2.0, 1.0)
# A query that names a provider ("arXiv papers", "hacker news on Rust") asked for that source: its endpoints' text
# score is multiplied by this, enough to lift them over a generic match ("arXiv papers" put OpenAlex first at 1.0
# vs arXiv 0.82 on 2026-10-12) without burying a far better tool from another provider.
DISCOVER_NAMED_PROVIDER_BOOST: Final = 2.0
DISCOVER_NAME_MAX_WORDS: Final = 3  # "open food facts" → openfoodfacts

# Health (a verdict per endpoint computed from our own runs; SKILL.md "Endpoint Health")
HEALTH_SAMPLES: Final = 200  # newest runs kept per endpoint
HEALTH_RECENT_S: Final = 900  # a success in the last 15 min → healthy
HEALTH_STABLE_MIN_RUNS: Final = 20
HEALTH_STABLE_RATE: Final = 0.95
HEALTH_DEGRADED_RATE: Final = 0.8
HEALTH_OUTAGE_STREAK: Final = 5  # this many failures in a row → outage
HEALTH_P50: Final = 0.5
HEALTH_P95: Final = 0.95
HEALTH_KEY_PREFIX: Final = "hako:tools:health"
# Health is bookkeeping: a slow Redis must never hold a run's response (2026-10-07: a connect timeout under load
# delayed a paid run past the gateway's deadline). Writes go to a background task with these socket timeouts.
HEALTH_REDIS_CONNECT_S: Final = 0.3
HEALTH_REDIS_TIMEOUT_S: Final = 0.5

# Cache TTLs (seconds), chosen per data's real rate of change
TTL_SEARCH_S: Final = 600
TTL_PAGE_S: Final = 3_600
TTL_REFERENCE_S: Final = 86_400  # papers, packages, dictionary entries, encyclopaedia summaries
TTL_LIVE_S: Final = 60  # weather now, FX intraday, quakes
TTL_FORECAST_S: Final = 900  # weather models refresh about hourly; 15 min keeps "current" honest

# Provider connections: a cold TLS handshake to a US API took > 1 s from the dev box (2026-10-07: Firecrawl
# ConnectTimeout at 1.0 s, then 0.9 s for the whole call once warm); the run deadline still bounds the total.
PROVIDER_CONNECT_S: Final = 3.0
PROVIDER_TIMEOUT_DEFAULT_S: Final = 8.0
PROVIDER_CONCURRENCY_DEFAULT: Final = 4

# One User-Agent for every upstream (Groq answers 403 to python-urllib's default; Wikimedia and SEC want contact).
USER_AGENT_PRODUCT: Final = "Hako/1.0"
