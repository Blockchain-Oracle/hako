"""jupiter/events: Jupiter Prediction events matching a question, one row per binary market with YES/NO odds."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.jupiter.provider import JUPITER
from hako_tools.connectors.polymarket.markets import (
    LIMIT_DEFAULT,
    LIMIT_MAX,
    QUERY_MAX_CHARS,
    MarketsOutput,
    Outcome,
    PredictionMarket,
)
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, Render, RunContext, ToolInput, ToolNotFoundResult, tool

MICRO_USD = 1_000_000  # Jupiter quotes prices and volumes in micro-USD
EVENTS_PER_SEARCH = 10
OPEN = "open"
YES, NO = "Yes", "No"


class EventsInput(ToolInput):
    query: str = Field(min_length=1, max_length=QUERY_MAX_CHARS,
                       description="What the event is about: 'bitcoin', 'Lakers', 'election'.")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX, description="Markets to return.")


def _usd(micro: Any) -> float | None:
    try:
        return int(micro) / MICRO_USD if micro not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _mid(buy: float | None, sell: float | None) -> float | None:
    """The midpoint of the YES (or NO) bid and ask: the market's implied probability (0 means no quote)."""
    quotes = [q for q in (buy, sell) if q]
    return min(max(sum(quotes) / len(quotes), 0.0), 1.0) if quotes else None


def _odds(market: dict[str, Any]) -> tuple[float | None, float | None]:
    pricing = market.get("pricing") or {}
    return (_mid(_usd(pricing.get("buyYesPriceUsd")), _usd(pricing.get("sellYesPriceUsd"))),
            _mid(_usd(pricing.get("buyNoPriceUsd")), _usd(pricing.get("sellNoPriceUsd"))))


def _team_event(event: dict[str, Any]) -> PredictionMarket | None:
    """An event whose markets are its options (Up / Down, team A / team B): one row, each option's YES odds."""
    meta = event.get("metadata") or {}
    options = [m for m in event.get("markets") or [] if isinstance(m, dict) and m.get("status") == OPEN]
    outcomes = [Outcome(name=str(m.get("title")), probability=yes, price_usd=_usd((m.get("pricing") or {}).get(
        "buyYesPriceUsd"))) for m in options if (yes := _odds(m)[0]) is not None]
    if not outcomes:
        return None
    return PredictionMarket(
        id=str(event.get("eventId")), provider=JUPITER.id, title=str(meta.get("title") or ""), outcomes=outcomes,
        status=OPEN, end_date=meta.get("closeTime") or None, volume_usd=_usd(event.get("volumeUsd")),
        category=event.get("category"), image_url=meta.get("imageUrl"))


def _market(event: dict[str, Any], market: dict[str, Any]) -> PredictionMarket | None:
    yes, no = _odds(market)
    pricing = market.get("pricing") or {}
    if yes is None and no is None:
        return None
    yes = yes if yes is not None else 1.0 - (no or 0.0)
    no = no if no is not None else 1.0 - yes
    meta = event.get("metadata") or {}
    several = len(event.get("markets") or []) > 1
    title = str(meta.get("title") or market.get("title") or "")
    result = market.get("result")
    status = "resolved" if result else (OPEN if market.get("status") == OPEN else "closed")
    return PredictionMarket(
        id=str(market.get("marketId")), provider=JUPITER.id,
        title=f"{title}: {market.get('title')}" if several and market.get("title") else title,
        outcomes=[Outcome(name=YES, probability=yes, price_usd=_usd(pricing.get("buyYesPriceUsd"))),
                  Outcome(name=NO, probability=no, price_usd=_usd(pricing.get("buyNoPriceUsd")))],
        status=status, end_date=meta.get("closeTime") or None,
        volume_usd=_usd(event.get("volumeUsd")) if not several else None, category=event.get("category"),
        image_url=market.get("imageUrl") or meta.get("imageUrl"), resolved_outcome=str(result) if result else None,
        event=title if several else None,
    )


@tool(
    provider=JUPITER,
    slug="events",
    name="Jupiter Prediction Markets",
    summary="Jupiter Prediction events for a question, tradable on Solana: each market's YES/NO implied odds.",
    description="Searches Jupiter's prediction markets (beta API; sports, crypto, politics, e-sports, culture) and "
    "returns one row per binary market: the question, YES and NO implied probabilities (the midpoint of each side's "
    "bid and ask), status and close time, category and the event's volume. Many markets mirror Polymarket's "
    "(ids POLY-<id>). Read only; trading happens in Jupiter's app. For Polymarket and Jupiter together, plus news, "
    "use hako/markets.",
    categories=(Category.finance, Category.crypto),
    render=Render.market,
    price=FREE,
    example={"query": "bitcoin", "limit": 3},
    see_also=("hako/markets", "polymarket/markets"),
    cache_ttl_s=TTL_LIVE_S,
)
async def events(inp: EventsInput, ctx: RunContext) -> MarketsOutput:
    data = await ctx.get_json(JUPITER, "/events/search",
                              params={"query": inp.query, "limit": EVENTS_PER_SEARCH, "includeMarkets": "true"})
    found: list[PredictionMarket] = []
    for event in (data or {}).get("data") or []:
        if not isinstance(event, dict) or not event.get("isActive", True):
            continue
        markets = [m for m in event.get("markets") or [] if isinstance(m, dict)]
        if markets and all(m.get("isTeamMarket") for m in markets):
            team = _team_event(event)
            found += [team] if team else []
            continue
        for market in markets:
            row = _market(event, market)
            if row and row.status == OPEN:
                found.append(row)
        if len(found) >= inp.limit:
            break
    if not found:
        raise ToolNotFoundResult(f"No open Jupiter prediction markets for {inp.query!r}")
    return MarketsOutput(markets=found[:inp.limit], query=inp.query)
