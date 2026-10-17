"""polymarket/markets: prediction markets matching a question, with each outcome's implied probability."""

from enum import StrEnum
from typing import Any

import orjson
from pydantic import Field

from hako_tools.connectors.polymarket.provider import POLYMARKET
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

# @hako/cards contract.config.ts: MARKET_QUERY_MAX_CHARS, MARKETS_LIMIT_DEFAULT, MARKETS_LIMIT_MAX.
QUERY_MAX_CHARS = 200
LIMIT_DEFAULT = 5
LIMIT_MAX = 20
EVENTS_PER_SEARCH = 10  # Gamma ranks events; their markets fill the rows
EVENT_URL = "https://polymarket.com/event/{slug}"
RESOLVED = "resolved"


class MarketStatus(StrEnum):
    open = "open"
    closed = "closed"
    all = "all"


class MarketsInput(ToolInput):
    query: str = Field(min_length=1, max_length=QUERY_MAX_CHARS,
                       description="What the market is about: 'bitcoin 150k', 'US election', 'Champions League'.")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX, description="Markets to return.")
    status: MarketStatus = Field(MarketStatus.open, description="open (trading now), closed, or all.")


class Outcome(ToolOutput):
    name: str
    probability: float = Field(description="Implied probability, 0–1 (the outcome's price).")
    price_usd: float | None = None


class PredictionMarket(ToolOutput):
    id: str
    provider: str
    title: str
    outcomes: list[Outcome]
    status: str = Field(description="open, closed or resolved.")
    url: str | None = None
    end_date: str | None = None
    volume_usd: float | None = None
    liquidity_usd: float | None = None
    category: str | None = None
    image_url: str | None = None
    resolved_outcome: str | None = None
    event: str | None = Field(default=None, description="The event this market belongs to, when it has several.")


class MarketsOutput(ToolOutput):
    markets: list[PredictionMarket]
    query: str | None = None


def _json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    try:
        parsed = orjson.loads(value) if isinstance(value, str) else []
    except orjson.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _number(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _market(event: dict[str, Any], market: dict[str, Any]) -> PredictionMarket | None:
    names = [str(n) for n in _json_list(market.get("outcomes"))]
    prices = [_number(p) for p in _json_list(market.get("outcomePrices"))]
    if not names or len(names) != len(prices) or any(p is None for p in prices):
        return None
    outcomes = [Outcome(name=n, probability=min(max(p or 0.0, 0.0), 1.0), price_usd=p)
                for n, p in zip(names, prices, strict=True)]
    resolved = market.get("umaResolutionStatus") == RESOLVED
    status = RESOLVED if resolved else ("closed" if market.get("closed") else "open")
    winner = max(outcomes, key=lambda o: o.probability).name if resolved else None
    several = len(event.get("markets") or []) > 1
    tags = [t.get("label") for t in event.get("tags") or [] if isinstance(t, dict) and t.get("label")]
    return PredictionMarket(
        id=str(market["id"]), provider=POLYMARKET.id, title=str(market.get("question") or event.get("title")),
        outcomes=outcomes, status=status, url=EVENT_URL.format(slug=event.get("slug")) if event.get("slug") else None,
        end_date=market.get("endDate") or event.get("endDate"), volume_usd=_number(market.get("volumeNum")),
        liquidity_usd=_number(market.get("liquidityNum")), category=tags[0] if tags else None,
        image_url=market.get("image") or event.get("image"), resolved_outcome=winner,
        event=str(event.get("title")) if several else None,
    )


def rows(events: list[dict[str, Any]], limit: int, status: MarketStatus) -> list[PredictionMarket]:
    """Events in Gamma's order; within each, its markets by volume; then cut to `limit`."""
    out: list[PredictionMarket] = []
    for event in events:
        markets = sorted(event.get("markets") or [], key=lambda m: -(_number(m.get("volumeNum")) or 0.0))
        for market in markets:
            row = _market(event, market)
            if row and (status is MarketStatus.all or (row.status == "open") == (status is MarketStatus.open)):
                out.append(row)
            if len(out) >= limit:
                return out
    return out


@tool(
    provider=POLYMARKET,
    slug="markets",
    name="Polymarket Odds",
    summary="Polymarket prediction markets for a question: each outcome's implied probability, volume, liquidity.",
    description="Searches Polymarket (Gamma API) for events matching a question and returns their markets, most "
    "traded first: the question, every outcome with its implied probability (its price, 0–1), status (open, closed "
    "or resolved, with the winner), end date, volume and liquidity in USD, and the event link. Read only: trading "
    "needs a Polymarket account (or PayBox's World plugin), not this tool. For both Polymarket and Jupiter at once, "
    "plus news, use hako/markets.",
    categories=(Category.finance, Category.crypto),
    render=Render.market,
    price=FREE,
    example={"query": "bitcoin", "limit": 3},
    see_also=("hako/markets", "jupiter/events"),
    cache_ttl_s=TTL_LIVE_S,
)
async def markets(inp: MarketsInput, ctx: RunContext) -> MarketsOutput:
    params: dict[str, Any] = {"q": inp.query, "limit_per_type": EVENTS_PER_SEARCH, "search_tags": "false",
                              "search_profiles": "false"}
    if inp.status is not MarketStatus.all:
        params["events_status"] = "active" if inp.status is MarketStatus.open else "closed"
    data = await ctx.get_json(POLYMARKET, "/public-search", params=params)
    events = [e for e in (data or {}).get("events") or [] if isinstance(e, dict)]
    found = rows(events, inp.limit, inp.status)
    if not found:
        raise ToolNotFoundResult(f"No {inp.status.value} Polymarket markets for {inp.query!r}")
    return MarketsOutput(markets=found, query=inp.query)
