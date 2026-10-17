"""`discover`: rank the whole catalog for a job description (SQLite FTS5 BM25 over agent-written metadata),
then break ties on health and price, and attach hints naming what to call next."""

import re
import sqlite3
from functools import lru_cache
from typing import Any

from hako_tools.categories import Category
from hako_tools.constants import (
    DISCOVER_DEFAULT_LIMIT,
    DISCOVER_MAX_LIMIT,
    DISCOVER_MIN_TOKEN_CHARS,
    DISCOVER_NAME_MAX_WORDS,
    DISCOVER_NAMED_PROVIDER_BOOST,
    DISCOVER_PREFIX_MIN_CHARS,
    DISCOVER_QUERY_MAX_CHARS,
    DISCOVER_WEIGHTS,
    PAID_RUN_PREFIX,
)
from hako_tools.framework.catalog import endpoints
from hako_tools.framework.endpoint import REGISTRY, Endpoint
from hako_tools.framework.health import HealthStatus, health

# Words agents use for the same job (expanded before matching; domain vocabulary, not tuning knobs).
SYNONYMS: dict[str, tuple[str, ...]] = {
    "scrape": ("extract", "page", "markdown", "fetch"),
    "crawl": ("scrape", "extract", "map"),
    "google": ("search", "serp"),
    "serp": ("search", "google"),
    "lookup": ("search", "find"),
    "paper": ("papers", "research", "scholarly"),
    "papers": ("research", "scholarly", "arxiv"),
    "article": ("news", "papers"),
    "headlines": ("news",),
    "summarise": ("summarize", "summary"),
    "summary": ("summarize",),
    "ask": ("answer", "question"),
    "question": ("answer", "ask"),
    "currency": ("fx", "exchange", "rates"),
    "exchange": ("fx", "currency"),
    "stock": ("quote", "market", "equities"),
    "price": ("quote", "rates"),
    "forecast": ("weather",),
    "temperature": ("weather",),
    "library": ("package", "npm", "pypi"),
    "dependency": ("package", "npm", "pypi"),
    "repo": ("github", "repository"),
    "ip": ("geolocation", "asn", "network"),
    "law": ("government", "statute", "regulation"),
    "regulation": ("government", "law"),
    "define": ("dictionary", "definition", "meaning"),
    "word": ("dictionary", "language", "synonym"),
    "job": ("jobs", "hiring", "careers"),
    "hiring": ("jobs",),
    "holiday": ("holidays", "calendar"),
    "timezone": ("time", "zone"),
    # crypto words point at coin prices; DeFi value locked keeps its own words (defi, tvl)
    "crypto": ("coin", "coingecko"),
    "cryptocurrency": ("crypto", "coin", "coingecko"),
    "cryptocurrencies": ("crypto", "coin", "coingecko"),
    "bitcoin": ("crypto", "coin", "btc"),
    "btc": ("crypto", "coin", "bitcoin"),
    "ethereum": ("crypto", "coin", "eth"),
    "eth": ("crypto", "coin", "ethereum"),
    "solana": ("crypto", "coin"),
    "token": ("crypto", "coin"),
    "defi": ("tvl", "protocol"),
    "weeks": ("forecast", "16"),
    "fortnight": ("forecast", "16"),
    "surf": ("marine", "wave"),
    "waves": ("marine", "wave"),
    "gps": ("coordinates", "reverse"),
    "convert": ("fx", "currency", "exchange"),
}
# ISO 4217 codes agents type in money questions ("100 USD in NGN"): each one means an exchange-rate lookup
FX_CODES = ("usd", "eur", "gbp", "ngn", "jpy", "cny", "inr", "cad", "aud", "chf", "zar", "kes", "ghs", "brl", "mxn")
SYNONYMS.update({code: ("fx", "currency", "exchange", "rates") for code in FX_CODES})

_TOKEN = re.compile(r"[a-z0-9]+")
_RANK_STATUS = {
    HealthStatus.healthy: 0,
    HealthStatus.stable: 1,
    HealthStatus.unknown: 2,
    HealthStatus.degraded: 3,
    HealthStatus.outage: 4,
}


@lru_cache(maxsize=1)
def _index() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.execute(
        "CREATE VIRTUAL TABLE ep USING fts5(id UNINDEXED, name, summary, categories, provider, description,"
        " tokenize='porter unicode61')"
    )
    db.executemany(
        "INSERT INTO ep VALUES (?,?,?,?,?,?)",
        [
            (
                e.id,
                e.display_name,
                e.summary,
                " ".join(c.value.replace("-", " ") for c in e.categories),
                f"{e.provider.display_name} {e.provider.id}",
                f"{e.description} {' '.join(e.notes)}",
            )
            for e in endpoints()
        ],
    )
    return db


def _terms(query: str) -> list[str]:
    words = [w for w in _TOKEN.findall(query.lower()[:DISCOVER_QUERY_MAX_CHARS]) if len(w) >= DISCOVER_MIN_TOKEN_CHARS]
    expanded = list(dict.fromkeys(words + [s for w in words for s in SYNONYMS.get(w, ())]))
    return [f'"{t}"*' if len(t) >= DISCOVER_PREFIX_MIN_CHARS else f'"{t}"' for t in expanded]


def _named_providers(query: str) -> set[str]:
    """Providers the query names outright, as typed (never via synonyms): 'arxiv', 'hacker news', 'open-meteo'."""
    words = _TOKEN.findall(query.lower()[:DISCOVER_QUERY_MAX_CHARS])
    said = {"".join(words[i:i + n]) for n in range(1, DISCOVER_NAME_MAX_WORDS + 1) for i in range(len(words) - n + 1)}
    return {e.provider.id for e in endpoints() if e.provider.id.replace("-", "") in said}


def _search(query: str) -> list[tuple[str, float]]:
    terms = _terms(query)
    if not terms:
        return []
    weights = ", ".join(str(w) for w in DISCOVER_WEIGHTS)
    rows = _index().execute(
        f"SELECT id, bm25(ep, 0.0, {weights}) AS s FROM ep WHERE ep MATCH ? ORDER BY s",
        (" OR ".join(terms),),
    ).fetchall()
    named = _named_providers(query)
    scored = [
        (r[0], -float(r[1]) * (DISCOVER_NAMED_PROVIDER_BOOST if r[0].split("/", 1)[0] in named else 1.0))
        for r in rows
    ]
    return sorted(scored, key=lambda pair: -pair[1])


def _hints(top: Endpoint, ranked: list[Endpoint]) -> list[str]:
    inspect = f"POST /v1/inspect with {{\"id\": \"{top.id}\"}} for its input schema"
    if top.price.free:
        hints = [f"{inspect}; it is free: the gateway serves it on its free read routes (hako_chain_read, "
                 f"hako_markets, Earn), never on {PAID_RUN_PREFIX}."]
    else:
        hints = [f"{inspect}, then pay POST {PAID_RUN_PREFIX}/{top.id} with PayBox use_service."]
    # A free read shares broad categories with almost everything (chain-evm/gas is "crypto" like coingecko/price): it
    # counts as cheaper only when it makes the same card, so the hint never points at an unrelated tool.
    cheaper = [e for e in ranked if e.price.atomic < top.price.atomic and set(e.categories) & set(top.categories)
               and (not e.price.free or e.render == top.render)]
    if cheaper:
        c = cheaper[0]
        price = "free" if c.price.free else f"${c.price.usd} per call"
        hints.append(f"Cheaper for the same kind of job: {c.id} ({price}).")
    hints.extend(f"Related: {sid}" for sid in top.see_also if sid in REGISTRY)
    return hints


async def discover(query: str, *, category: Category | None = None, limit: int = DISCOVER_DEFAULT_LIMIT,
                   include_unavailable: bool = False) -> dict[str, Any]:
    limit = max(1, min(limit, DISCOVER_MAX_LIMIT))
    scored = _search(query)
    pool = [(REGISTRY[i], s) for i, s in scored if i in REGISTRY]
    pool = [
        (e, s) for e, s in pool
        if (include_unavailable or e.available) and (category is None or category in e.categories)
    ]
    snapshots = await health.snapshots([e.id for e, _ in pool])
    best = pool[0][1] if pool else 1.0
    candidates = [
        {
            **e.summary_doc(),
            "score": round(s / best, 3) if best > 0 else 0.0,
            "health": snapshots.get(e.id),
        }
        for e, s in pool
    ]
    candidates.sort(key=lambda c: (-round(c["score"], 1), _RANK_STATUS.get(c["health"]["status"], 2),
                                   int(c["price"]["atomic"])))
    candidates = candidates[:limit]
    ranked = [REGISTRY[c["id"]] for c in candidates]
    return {
        "query": query,
        "count": len(candidates),
        "candidates": candidates,
        "hints": _hints(ranked[0], ranked) if ranked else [
            "Nothing matched. Try plainer words (\"web search\", \"weather\", \"npm package\"), or GET /v1/catalog."
        ],
    }
