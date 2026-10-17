"""CoinGecko prices (by symbol, id or name), the top coins by market cap and the trending list."""

import re
from typing import Any

from pydantic import Field

from hako_tools.connectors.coingecko.provider import COINGECKO
from hako_tools.constants import TTL_LIVE_S, TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

COINS_MAX = 10
COIN_MAX_CHARS = 60
TOP_DEFAULT = 10
TOP_MAX = 50
CATEGORY_MAX_CHARS = 60
CURRENCY_PATTERN = r"^[a-z]{3,5}$"
PRICE_CHANGES = "24h,7d"
PCT_DECIMALS = 2
COIN_PAGE = "https://www.coingecko.com/en/coins/{id}"
_NON_ID = re.compile(r"[^a-z0-9]+")


class Quote(ToolOutput):
    id: str
    symbol: str
    name: str
    price: float | None = None
    currency: str
    change_pct: float | None = Field(None, description="24-hour change, percent.")
    change_7d_pct: float | None = None
    market_cap: float | None = None
    market_cap_rank: int | None = None
    volume: float | None = None
    high: float | None = Field(None, description="24-hour high.")
    low: float | None = Field(None, description="24-hour low.")
    ath: float | None = None
    ath_change_pct: float | None = None
    image_url: str | None = None
    url: str


def _pct(value: Any) -> float | None:
    return round(float(value), PCT_DECIMALS) if isinstance(value, int | float) else None


def _quote(row: dict[str, Any], currency: str) -> Quote:
    coin_id = str(row["id"])
    return Quote(
        id=coin_id, symbol=str(row.get("symbol") or "").upper(), name=row.get("name") or coin_id,
        price=row.get("current_price"), currency=currency.upper(),
        change_pct=_pct(row.get("price_change_percentage_24h_in_currency", row.get("price_change_percentage_24h"))),
        change_7d_pct=_pct(row.get("price_change_percentage_7d_in_currency")), market_cap=row.get("market_cap"),
        market_cap_rank=row.get("market_cap_rank"), volume=row.get("total_volume"), high=row.get("high_24h"),
        low=row.get("low_24h"), ath=row.get("ath"), ath_change_pct=_pct(row.get("ath_change_percentage")),
        image_url=row.get("image"), url=COIN_PAGE.format(id=coin_id))


async def _markets(ctx: RunContext, currency: str, **params: Any) -> list[dict[str, Any]]:
    rows = await ctx.get_json(COINGECKO, "/coins/markets", params={
        "vs_currency": currency, "price_change_percentage": PRICE_CHANGES, **params})
    return [r for r in rows or [] if isinstance(r, dict) and r.get("id")]


class PriceInput(ToolInput):
    coins: list[str] = Field(min_length=1, max_length=COINS_MAX,
                             description="Up to 10 coins by ticker, CoinGecko id or name: ['btc', 'ethereum', "
                             "'Shiba Inu']. A ticker shared by several coins means the largest by market cap.")
    vs_currency: str = Field("usd", pattern=CURRENCY_PATTERN,
                             description="Quote currency, lower case: usd, eur, ngn, jpy, btc, eth…")


class PriceOutput(ToolOutput):
    quotes: list[Quote]
    missing: list[str] = Field(default_factory=list, description="Coins CoinGecko did not recognise.")


@tool(
    provider=COINGECKO,
    slug="price",
    name="CoinGecko Crypto Prices",
    summary="Live crypto prices by ticker or name: price, 24h and 7d change, market cap, volume, 24h range, ATH.",
    description="Current market data for up to 10 coins named by ticker ('btc'), CoinGecko id ('ethereum') or name "
    "('Shiba Inu'), quoted in any major fiat or crypto currency: price, 24-hour and 7-day change, market cap and "
    "rank, 24h volume, high and low, and the all-time high with the distance from it. Prices refresh about every "
    "minute. For the leaderboard use coingecko/top; for what people are searching use coingecko/trending; for "
    "DeFi protocol value locked use defillama/protocol.",
    categories=(Category.crypto, Category.finance),
    render=Render.quote,
    price=LOCAL,
    example={"coins": ["btc", "eth", "sol"], "vs_currency": "usd"},
    see_also=("coingecko/top", "coingecko/trending", "defillama/protocol"),
    cache_ttl_s=TTL_LIVE_S,
)
async def price(inp: PriceInput, ctx: RunContext) -> PriceOutput:
    wanted = list(dict.fromkeys(c.strip() for c in inp.coins if c.strip()))
    found: dict[str, dict[str, Any]] = {}
    tickers = [c.lower() for c in wanted if c.isalnum()]
    if tickers:
        for row in await _markets(ctx, inp.vs_currency, symbols=",".join(tickers)):
            found.setdefault(str(row.get("symbol", "")).lower(), row)
    unmatched = [c for c in wanted if c.lower() not in found]
    if unmatched:
        ids = {_NON_ID.sub("-", c.lower()).strip("-"): c for c in unmatched}
        for row in await _markets(ctx, inp.vs_currency, ids=",".join(ids)):
            if row["id"] in ids:
                found[ids[row["id"]].lower()] = row
    quotes = [_quote(found[c.lower()], inp.vs_currency) for c in wanted if c.lower() in found]
    if not quotes:
        raise ToolNotFoundResult(f"CoinGecko recognised none of {', '.join(wanted)}")
    return PriceOutput(quotes=quotes, missing=[c for c in wanted if c.lower() not in found])


class TopInput(ToolInput):
    limit: int = Field(TOP_DEFAULT, ge=1, le=TOP_MAX)
    vs_currency: str = Field("usd", pattern=CURRENCY_PATTERN)
    category: str | None = Field(None, max_length=CATEGORY_MAX_CHARS,
                                 description="A CoinGecko category id: 'layer-1', 'meme-token', 'stablecoins', "
                                 "'decentralized-finance-defi', 'artificial-intelligence'.")


class TopOutput(ToolOutput):
    category: str | None = None
    quotes: list[Quote]


@tool(
    provider=COINGECKO,
    slug="top",
    name="CoinGecko Top Coins",
    summary="The largest coins by market cap, overall or within a category (layer-1, meme, stablecoins, AI…).",
    description="The crypto market-cap leaderboard: up to 50 coins ranked by market cap with price, 24h and 7d "
    "change, volume and 24h range, optionally within one CoinGecko category such as 'layer-1', 'meme-token', "
    "'stablecoins' or 'artificial-intelligence'. Use it for 'what are the biggest coins' or a sector overview; for "
    "specific coins use coingecko/price.",
    categories=(Category.crypto, Category.finance),
    render=Render.quote,
    price=LOCAL,
    example={"limit": 5},
    see_also=("coingecko/price", "coingecko/trending"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def top(inp: TopInput, ctx: RunContext) -> TopOutput:
    params: dict[str, Any] = {"order": "market_cap_desc", "per_page": inp.limit, "page": 1}
    if inp.category:
        params["category"] = inp.category.strip().lower()
    rows = await _markets(ctx, inp.vs_currency, **params)
    if not rows:
        raise ToolNotFoundResult(f"no coins in CoinGecko category {inp.category!r}")
    return TopOutput(category=inp.category, quotes=[_quote(r, inp.vs_currency) for r in rows])


class TrendingInput(ToolInput):
    pass


class TrendingCoin(ToolOutput):
    id: str
    symbol: str
    name: str
    market_cap_rank: int | None = None
    price: float | None = Field(None, description="USD.")
    currency: str = "USD"
    change_pct: float | None = Field(None, description="24-hour change in USD, percent.")
    market_cap: str | None = Field(None, description="As CoinGecko formats it, e.g. '$1,234,567'.")
    url: str


class TrendingOutput(ToolOutput):
    quotes: list[TrendingCoin] = Field(description="Most searched on CoinGecko in the last 24 hours, top first.")


@tool(
    provider=COINGECKO,
    slug="trending",
    name="CoinGecko Trending Coins",
    summary="The coins most searched on CoinGecko in the last 24 hours, with price and 24h change.",
    description="CoinGecko's trending list: the coins most searched by its users in the last 24 hours (about 15), "
    "top first, with market-cap rank, USD price, 24-hour change and market cap. A sentiment signal, not a "
    "ranking by size (that is coingecko/top).",
    categories=(Category.crypto,),
    render=Render.quote,
    price=LOCAL,
    example={},
    see_also=("coingecko/top", "coingecko/price"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def trending(inp: TrendingInput, ctx: RunContext) -> TrendingOutput:
    data = await ctx.get_json(COINGECKO, "/search/trending") or {}
    coins: list[TrendingCoin] = []
    for entry in data.get("coins") or []:
        item = entry.get("item") or {}
        if not item.get("id"):
            continue
        stats = item.get("data") or {}
        coins.append(TrendingCoin(
            id=item["id"], symbol=str(item.get("symbol") or "").upper(), name=item.get("name") or item["id"],
            market_cap_rank=item.get("market_cap_rank"), price=stats.get("price"),
            change_pct=_pct((stats.get("price_change_percentage_24h") or {}).get("usd")),
            market_cap=stats.get("market_cap"), url=COIN_PAGE.format(id=item["id"])))
    if not coins:
        raise ToolNotFoundResult("CoinGecko returned no trending coins")
    return TrendingOutput(quotes=coins)
