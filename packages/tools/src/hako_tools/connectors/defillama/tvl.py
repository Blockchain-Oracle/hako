"""DefiLlama TVL endpoints: one protocol (or a protocol family) and the top chains.

`/protocol/{slug}` carries the protocol's entire daily history (10 MB for Aave, 18 s measured 2026-10-07), so the
protocol lookup reads the `/protocols` listing instead (2.4 MB gzipped, 2-7 s measured on a slow link), which
already has the current TVL and the 1-hour, 1-day and 7-day changes for every protocol. The listing is trimmed to
the fields used here and kept in the shared cache, so only the first lookup in each TTL window pays for it.
"""

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import Field

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache
from hako_core.contract.enums import CacheState, SourceStatus
from hako_core.contract.sources import SourceRef
from hako_tools.connectors.defillama.provider import DEFILLAMA
from hako_tools.constants import RUN_DEADLINE_MAX_S, TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

PROTOCOL_MAX_CHARS = 100
TOP_CHAINS = 8
MAX_CHILDREN = 15
SUGGESTIONS = 5
PERCENT = 100
PCT_DECIMALS = 3
USD_DECIMALS = 0
CHAINS_DEFAULT = 10
CHAINS_MAX = 50
# chainTvls keys such as "Ethereum-borrowed" or bare "staking" are extra TVL categories, not chains.
TVL_CATEGORIES = frozenset({"staking", "borrowed", "pool2", "vesting", "offers", "treasury", "doublecounted",
                            "liquidstaking", "dcAndLsOverlap"})
PROTOCOL_PAGE = "https://defillama.com/protocol/"
INDEX_KEY = cache_key("tools", "defillama", "protocols", "index")
INDEX_TTL = timedelta(seconds=TTL_SEARCH_S)
_KEEP = ("name", "slug", "category", "symbol", "url", "tvl", "change_1h", "change_1d", "change_7d", "mcap", "chains",
         "parentProtocol", "parentProtocolSlug")


class ProtocolInput(ToolInput):
    protocol: str = Field(min_length=2, max_length=PROTOCOL_MAX_CHARS,
                          description="DefiLlama slug or name, e.g. 'aave-v3', 'Lido' or a family such as 'uniswap'.")


class ChainTvl(ToolOutput):
    chain: str
    tvl_usd: float


class ChildProtocol(ToolOutput):
    name: str
    slug: str
    category: str | None = None
    tvl_usd: float | None = None


class ProtocolOutput(ToolOutput):
    name: str
    slug: str
    category: str | None = None
    symbol: str | None = None
    url: str | None = None
    defillama_url: str
    tvl_usd: float | None = None
    change_1h_pct: float | None = None
    change_1d_pct: float | None = None
    change_7d_pct: float | None = None
    mcap_usd: float | None = None
    chains: list[str] = Field(default_factory=list)
    top_chains: list[ChainTvl] = Field(default_factory=list)
    parent: str | None = None  # the family slug (aave-v3 → aave)
    children: list[ChildProtocol] = Field(default_factory=list)  # when the slug names a family


def _num(value: Any, decimals: int) -> float | None:
    return round(float(value), decimals) if isinstance(value, int | float) else None


def _is_chain(key: str) -> bool:
    return key not in TVL_CATEGORIES and key.rsplit("-", 1)[-1] not in TVL_CATEGORIES


def _trim(row: dict[str, Any]) -> dict[str, Any]:
    """Keep what this module reads, with each protocol's top chains instead of its full chainTvls map."""
    out = {k: row[k] for k in _KEEP if row.get(k) not in (None, "", [])}
    chains = [(c, v) for c, v in (row.get("chainTvls") or {}).items() if _is_chain(c) and isinstance(v, int | float)]
    out["chain_tvls"] = dict(sorted(chains, key=lambda cv: -cv[1])[:TOP_CHAINS])
    return out


async def _index(ctx: RunContext) -> list[dict[str, Any]]:
    hit = await cache.get(INDEX_KEY)
    if isinstance(hit, list):
        ctx.sources.append(SourceRef(name=DEFILLAMA.id, status=SourceStatus.ok, url=f"{DEFILLAMA.base_url}/protocols",
                                     attribution=DEFILLAMA.attribution, cache=CacheState.hit,
                                     fetched_at=datetime.now(UTC).isoformat(timespec="seconds")))
        return hit
    rows = await ctx.get_json(DEFILLAMA, "/protocols") or []
    index = [_trim(r) for r in rows if isinstance(r, dict) and r.get("slug")]
    await cache.set(INDEX_KEY, index, INDEX_TTL)
    return index


def _top_chains(rows: list[dict[str, Any]]) -> list[ChainTvl]:
    totals: Counter[str] = Counter()
    for row in rows:
        totals.update(row.get("chain_tvls") or {})
    return [ChainTvl(chain=c, tvl_usd=round(v, USD_DECIMALS)) for c, v in totals.most_common(TOP_CHAINS) if v > 0]


def _single(row: dict[str, Any]) -> ProtocolOutput:
    slug = str(row.get("slug") or "")
    return ProtocolOutput(
        name=row.get("name") or slug, slug=slug, category=row.get("category"), symbol=row.get("symbol") or None,
        url=row.get("url") or None, defillama_url=f"{PROTOCOL_PAGE}{slug}", tvl_usd=_num(row.get("tvl"), USD_DECIMALS),
        change_1h_pct=_num(row.get("change_1h"), PCT_DECIMALS), change_1d_pct=_num(row.get("change_1d"), PCT_DECIMALS),
        change_7d_pct=_num(row.get("change_7d"), PCT_DECIMALS), mcap_usd=_num(row.get("mcap"), USD_DECIMALS),
        chains=row.get("chains") or [], top_chains=_top_chains([row]), parent=row.get("parentProtocolSlug"),
    )


def _family_change(rows: list[dict[str, Any]], field: str) -> float | None:
    """The family's % change: each member's earlier TVL is tvl / (1 + change), summed, against today's sum."""
    now = before = 0.0
    for row in rows:
        tvl, change = row.get("tvl"), row.get(field)
        if isinstance(tvl, int | float) and isinstance(change, int | float) and change > -PERCENT:
            now += tvl
            before += tvl / (1 + change / PERCENT)
    return round((now - before) / before * PERCENT, PCT_DECIMALS) if before else None


def _family_name(slug: str, names: list[str]) -> str:
    """'Aave V3', 'Aave V2', 'Aave Arc' → 'Aave' (the words every member shares), else the slug."""
    words = [n.split() for n in names if n]
    shared: list[str] = []
    for column in zip(*words, strict=False):
        if len(set(column)) != 1:
            break
        shared.append(column[0])
    return " ".join(shared) or slug


def _family(slug: str, rows: list[dict[str, Any]]) -> ProtocolOutput:
    rows = sorted(rows, key=lambda r: -(r.get("tvl") or 0))
    tvls = [r["tvl"] for r in rows if isinstance(r.get("tvl"), int | float)]
    categories = Counter(r["category"] for r in rows if r.get("category"))
    chains = list(dict.fromkeys(c for r in rows for c in r.get("chains") or []))
    return ProtocolOutput(
        name=_family_name(slug, [str(r.get("name") or "") for r in rows]), slug=slug,
        category=categories.most_common(1)[0][0] if categories else None, symbol=rows[0].get("symbol") or None,
        url=rows[0].get("url") or None, defillama_url=f"{PROTOCOL_PAGE}{slug}",
        tvl_usd=round(sum(tvls), USD_DECIMALS) if tvls else None,
        change_1h_pct=_family_change(rows, "change_1h"), change_1d_pct=_family_change(rows, "change_1d"),
        change_7d_pct=_family_change(rows, "change_7d"), chains=chains, top_chains=_top_chains(rows),
        children=[ChildProtocol(name=r.get("name") or "", slug=r.get("slug") or "", category=r.get("category"),
                                tvl_usd=_num(r.get("tvl"), USD_DECIMALS)) for r in rows[:MAX_CHILDREN]],
    )


@tool(
    provider=DEFILLAMA,
    slug="protocol",
    name="DefiLlama Protocol TVL",
    summary="A DeFi protocol's current TVL, 1h/1d/7d change, category, chains and its biggest chains by TVL.",
    description="Looks up a DeFi protocol by DefiLlama slug or name and returns its total value locked in USD, "
    "the 1-hour, 1-day and 7-day % change, category, token symbol, market cap, website, the chains it runs on "
    f"and its top {TOP_CHAINS} chains by TVL. A family slug such as 'aave' or 'uniswap' sums its versions "
    "(listed under children). Current values only, no history charts; borrowed and staked amounts are excluded "
    "from TVL as DefiLlama does by default. For chain totals use defillama/chains.",
    categories=(Category.crypto, Category.finance),
    render=Render.json,
    price=LOCAL,
    example={"protocol": "aave"},
    see_also=("defillama/chains", "serper/news", "hako/answer"),
    deadline_s=RUN_DEADLINE_MAX_S,  # a cold index download is 2.4 MB; every later lookup in the TTL is local
    cache_ttl_s=TTL_SEARCH_S,
)
async def protocol(inp: ProtocolInput, ctx: RunContext) -> ProtocolOutput:
    rows = await _index(ctx)
    wanted = inp.protocol.casefold()
    slug = wanted.replace(" ", "-")
    for row in rows:
        if str(row.get("slug") or "").casefold() == slug or str(row.get("name") or "").casefold() == wanted:
            return _single(row)
    members = [r for r in rows if str(r.get("parentProtocolSlug") or "").casefold() == slug
               or str(r.get("parentProtocol") or "").casefold() == f"parent#{slug}"]
    if members:
        return _family(slug, members)
    near = [str(r.get("slug")) for r in sorted(rows, key=lambda r: -(r.get("tvl") or 0))
            if wanted in str(r.get("name") or "").casefold() or slug in str(r.get("slug") or "")][:SUGGESTIONS]
    hint = f"; did you mean {', '.join(near)}?" if near else ""
    raise ToolNotFoundResult(f"DefiLlama lists no protocol called {inp.protocol!r}{hint}")


class ChainsInput(ToolInput):
    limit: int = Field(CHAINS_DEFAULT, ge=1, le=CHAINS_MAX, description="How many chains, largest TVL first.")


class ChainRow(ToolOutput):
    rank: int
    name: str
    tvl_usd: float
    share_pct: float
    token_symbol: str | None = None
    chain_id: int | None = None


class ChainsOutput(ToolOutput):
    total_tvl_usd: float
    chains_listed: int
    rows: list[ChainRow]


@tool(
    provider=DEFILLAMA,
    slug="chains",
    name="DefiLlama Top Chains by TVL",
    summary="Blockchains ranked by DeFi total value locked, with each one's share of all TVL.",
    description="Ranks every chain DefiLlama tracks by current DeFi TVL (USD) and returns the top N with its "
    "share of the total, gas-token symbol and EVM chain id where it has one. Current snapshot only. For one "
    "protocol use defillama/protocol.",
    categories=(Category.crypto, Category.finance),
    render=Render.table,
    price=LOCAL,
    example={"limit": 10},
    see_also=("defillama/protocol",),
    cache_ttl_s=TTL_SEARCH_S,
)
async def chains(inp: ChainsInput, ctx: RunContext) -> ChainsOutput:
    rows = [r for r in await ctx.get_json(DEFILLAMA, "/v2/chains") or []
            if isinstance(r, dict) and isinstance(r.get("tvl"), int | float)]
    rows.sort(key=lambda r: -r["tvl"])
    total = sum(r["tvl"] for r in rows)
    return ChainsOutput(
        total_tvl_usd=round(total, USD_DECIMALS),
        chains_listed=len(rows),
        rows=[
            ChainRow(rank=i + 1, name=r.get("name") or "", tvl_usd=round(r["tvl"], USD_DECIMALS),
                     share_pct=round(r["tvl"] / total * PERCENT, PCT_DECIMALS) if total else 0.0,
                     token_symbol=r.get("tokenSymbol"),
                     chain_id=r["chainId"] if isinstance(r.get("chainId"), int) else None)
            for i, r in enumerate(rows[: inp.limit])
        ],
    )
