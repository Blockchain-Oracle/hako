"""hako/markets: prediction-market odds for a question from Polymarket and Jupiter at once, with the news around it.

The gateway's free `/v1/markets` alias and `hako_markets` run this. Jupiter markets that mirror a Polymarket market
(`POLY-<id>`) are shown once, as Polymarket's row.
"""

import asyncio
from enum import StrEnum

from pydantic import Field

from hako_tools.connectors.googlenews.feeds import NewsOutput
from hako_tools.connectors.googlenews.provider import GOOGLE_NEWS
from hako_tools.connectors.hako.provider import HAKO
from hako_tools.connectors.jupiter.provider import JUPITER
from hako_tools.connectors.polymarket.markets import (
    LIMIT_DEFAULT,
    LIMIT_MAX,
    QUERY_MAX_CHARS,
    MarketsOutput,
    PredictionMarket,
)
from hako_tools.connectors.polymarket.provider import POLYMARKET
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import FREE, Category, ProviderError, Render, RunContext, ToolInput, ToolNotFoundResult, tool
from hako_tools.framework.errors import ToolError

NEWS_MAX = 3
NEWS_RECENCY = "week"
MIRROR_PREFIX = "POLY-"


class Source(StrEnum):
    polymarket = "polymarket"
    jupiter = "jupiter"


class HakoMarketsInput(ToolInput):
    query: str = Field(min_length=1, max_length=QUERY_MAX_CHARS,
                       description="The question: 'Will bitcoin hit 150k?', 'Champions League winner'.")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX, description="Markets to return across both sources.")
    provider: Source | None = Field(default=None, description="Only one source: polymarket or jupiter.")


class HakoMarketsOutput(MarketsOutput):
    news: list[dict[str, object]] | None = None


async def _source(ctx: RunContext, endpoint_id: str, inp: HakoMarketsInput) -> list[PredictionMarket]:
    try:
        out = await ctx.call(endpoint_id, {"query": inp.query, "limit": inp.limit})
    except ToolNotFoundResult:
        return []
    except ToolError as exc:
        ctx.note(f"{endpoint_id} did not answer: {exc.message}")
        return []
    return list(out.markets) if isinstance(out, MarketsOutput) else []


async def _news(ctx: RunContext, query: str) -> list[dict[str, object]]:
    try:
        out = await ctx.call("google-news/search", {"query": query, "limit": NEWS_MAX, "recency": NEWS_RECENCY})
    except (ToolNotFoundResult, ToolError):
        return []
    if not isinstance(out, NewsOutput):
        return []
    return [{**a.model_dump(exclude_none=True), "source": GOOGLE_NEWS.id} for a in out.articles]


def _interleave(poly: list[PredictionMarket], jup: list[PredictionMarket], limit: int) -> list[PredictionMarket]:
    """Both sources' best first, alternating, without Jupiter's mirrors of Polymarket rows already shown."""
    shown = {m.id for m in poly}
    jup = [m for m in jup if m.id.removeprefix(MIRROR_PREFIX) not in shown]
    out: list[PredictionMarket] = []
    for i in range(max(len(poly), len(jup))):
        out += [rows[i] for rows in (poly, jup) if i < len(rows)]
    return out[:limit]


@tool(
    provider=HAKO,
    slug="markets",
    name="Hako Prediction Markets",
    summary="Prediction-market odds for a question from Polymarket and Jupiter together, with this week's news.",
    description="Asks Polymarket (Gamma) and Jupiter Prediction at the same time for markets matching a question and "
    "returns them interleaved, best match first: each outcome's implied probability, status, end date, volume and "
    "the source; Jupiter's copies of Polymarket markets appear once. Adds up to 3 news headlines from the last week "
    "about the question (Google News). Pass provider to read one source only. Read only: trades hand off to PayBox's "
    "World plugin or the venue.",
    categories=(Category.finance, Category.crypto, Category.news),
    render=Render.market,
    price=FREE,
    example={"query": "bitcoin", "limit": 4},
    see_also=("polymarket/markets", "jupiter/events", "google-news/search"),
    cache_ttl_s=TTL_LIVE_S,
    requires=(POLYMARKET, JUPITER, GOOGLE_NEWS),
)
async def markets(inp: HakoMarketsInput, ctx: RunContext) -> HakoMarketsOutput:
    want_poly = inp.provider in (None, Source.polymarket)
    want_jup = inp.provider in (None, Source.jupiter)
    poly, jup, news = await asyncio.gather(
        _source(ctx, "polymarket/markets", inp) if want_poly else _empty(),
        _source(ctx, "jupiter/events", inp) if want_jup else _empty(),
        _news(ctx, inp.query),
    )
    found = _interleave(poly, jup, inp.limit)
    if not found:
        if ctx.notes:
            raise ProviderError(f"No prediction-market source answered for {inp.query!r}; retry shortly")
        raise ToolNotFoundResult(f"No open prediction markets for {inp.query!r}")
    return HakoMarketsOutput(markets=found, query=inp.query, news=news or None)


async def _empty() -> list[PredictionMarket]:
    return []
