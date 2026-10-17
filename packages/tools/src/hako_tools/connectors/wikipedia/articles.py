"""Wikipedia endpoints: article summary, title search, and the 'on this day' feed."""

import html
import re
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any, Self
from urllib.parse import quote

from pydantic import Field, model_validator

from hako_tools.connectors.wikipedia.provider import DEFAULT_LANG, LANG_PATTERN, WIKIPEDIA, wiki_get
from hako_tools.constants import RUN_DEADLINE_MAX_S, TTL_PAGE_S, TTL_REFERENCE_S, TTL_SEARCH_S
from hako_tools.framework import (
    LOCAL,
    Category,
    Link,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)

TITLE_MAX_CHARS = 255  # MediaWiki's page-title limit (in bytes; characters is the safe bound for input)
SEARCH_LIMIT_DEFAULT = 5
SEARCH_LIMIT_MAX = 10
OTD_LIMIT_DEFAULT = 10
OTD_LIMIT_MAX = 30
LEAP_YEAR = 2024  # validates 29 February as a real day
_TAG = re.compile(r"<[^>]+>")



def _lang() -> Any:
    return Field(DEFAULT_LANG, pattern=LANG_PATTERN, description="Wikipedia language edition, e.g. 'en', 'fr', 'ja'.")


def _plain(text: str | None) -> str | None:
    return html.unescape(_TAG.sub("", text)).strip() if text else None


def _page_url(lang: str, key: str) -> str:
    return f"https://{lang}.wikipedia.org/wiki/{quote(key.replace(' ', '_'), safe='/:()')}"


class SummaryInput(ToolInput):
    title: str = Field(min_length=1, max_length=TITLE_MAX_CHARS, description="Article title, e.g. 'Alan Turing'.")
    lang: str = _lang()


class SummaryOutput(ToolOutput):
    title: str
    description: str | None = None
    markdown: str  # the lead-section extract, plain text
    url: str
    thumbnail: str | None = None
    wikidata_id: str | None = None
    lang: str
    page_type: str | None = None  # standard | disambiguation | no-extract
    last_edited: str | None = None


@tool(
    provider=WIKIPEDIA,
    slug="summary",
    name="Wikipedia Article Summary",
    summary="The lead paragraph of a Wikipedia article: extract, short description, thumbnail and page URL.",
    description="Looks an article up by exact title (redirects are followed, so 'JFK' reaches John F. Kennedy) and "
    "returns its lead-section extract in plain text, the one-line description, a thumbnail and the Wikidata id. "
    "It does not search: if you are unsure of the title use wikipedia/search first. It returns only the lead, not "
    "the whole article; for the full page use firecrawl/scrape or jina/read on the URL. For structured facts "
    "(dates, population, website) use wikidata/entity with the returned wikidata_id.",
    categories=(Category.knowledge,),
    render=Render.page,
    price=LOCAL,
    example={"title": "Alan Turing"},
    see_also=("wikipedia/search", "wikidata/entity", "firecrawl/scrape"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def summary(inp: SummaryInput, ctx: RunContext) -> SummaryOutput:
    key = quote(inp.title.replace(" ", "_"), safe="")
    data = await wiki_get(ctx, inp.lang, f"/api/rest_v1/page/summary/{key}")
    page_type = data.get("type")
    if page_type == "disambiguation":
        ctx.note("This title is a disambiguation page; call wikipedia/search to choose the specific article.")
    urls = (data.get("content_urls") or {}).get("desktop") or {}
    return SummaryOutput(
        title=data.get("title") or inp.title,
        description=data.get("description"),
        markdown=data.get("extract") or "",
        url=urls.get("page") or _page_url(inp.lang, inp.title),
        thumbnail=(data.get("thumbnail") or {}).get("source"),
        wikidata_id=data.get("wikibase_item"),
        lang=data.get("lang") or inp.lang,
        page_type=page_type,
        last_edited=data.get("timestamp"),
    )


class SearchInput(ToolInput):
    query: str = Field(min_length=1, max_length=300, description="Words to find in article titles and text.")
    limit: int = Field(SEARCH_LIMIT_DEFAULT, ge=1, le=SEARCH_LIMIT_MAX)
    lang: str = _lang()


class SearchOutput(ToolOutput):
    query: str
    results: list[Link]


@tool(
    provider=WIKIPEDIA,
    slug="search",
    name="Wikipedia Search",
    summary="Find Wikipedia articles by keywords: titles, short descriptions and matching snippets.",
    description="Full-text search over one Wikipedia edition, ranked by Wikipedia's own relevance. Returns article "
    "titles, URLs, the short description and a snippet around the match. Use it to find the exact title, then "
    "wikipedia/summary for the lead paragraph. It searches Wikipedia only; for the open web use serper/search or "
    "firecrawl/search, and for structured entities use wikidata/search.",
    categories=(Category.knowledge,),
    render=Render.search_results,
    price=LOCAL,
    example={"query": "solid state battery", "limit": 5},
    see_also=("wikipedia/summary", "wikidata/search", "serper/search"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    data = await wiki_get(ctx, inp.lang, "/w/rest.php/v1/search/page", params={"q": inp.query, "limit": inp.limit})
    results = []
    for i, page in enumerate(data.get("pages") or []):
        description, excerpt = page.get("description"), _plain(page.get("excerpt"))
        snippet = f"{description}. {excerpt}" if description and excerpt else description or excerpt
        results.append(Link(title=page.get("title", ""), url=_page_url(inp.lang, page.get("key", "")),
                            snippet=snippet, source="wikipedia", position=i + 1))
    return SearchOutput(query=inp.query, results=results)


class OnThisDayKind(StrEnum):
    selected = "selected"  # editor-curated highlights (smallest and fastest feed)
    events = "events"
    births = "births"
    deaths = "deaths"
    holidays = "holidays"


class OnThisDayInput(ToolInput):
    month: int | None = Field(None, ge=1, le=12, description="1–12; defaults to today (UTC).")
    day: int | None = Field(None, ge=1, le=31, description="1–31; defaults to today (UTC).")
    kind: OnThisDayKind = Field(OnThisDayKind.selected, description="Curated highlights, events, births, deaths "
                                "or holidays.")
    limit: int = Field(OTD_LIMIT_DEFAULT, ge=1, le=OTD_LIMIT_MAX)
    lang: str = _lang()

    @model_validator(mode="after")
    def _real_day(self) -> Self:
        if (self.month is None) != (self.day is None):
            raise ValueError("give both month and day, or neither for today")
        if self.month is not None and self.day is not None:
            date(LEAP_YEAR, self.month, self.day)  # raises ValueError for 31 April etc.
        return self


class OnThisDayRow(ToolOutput):
    year: int | None = None
    text: str
    article: str | None = None
    url: str | None = None


class OnThisDayOutput(ToolOutput):
    month: int
    day: int
    kind: OnThisDayKind
    total: int
    rows: list[OnThisDayRow]


def _otd_row(item: dict[str, Any]) -> OnThisDayRow:
    pages = item.get("pages") or []
    first = pages[0] if pages else {}
    return OnThisDayRow(
        year=item.get("year"),
        text=item.get("text", ""),
        article=first.get("normalizedtitle") or first.get("title"),
        url=((first.get("content_urls") or {}).get("desktop") or {}).get("page"),
    )


@tool(
    provider=WIKIPEDIA,
    slug="on-this-day",
    name="Wikipedia On This Day",
    summary="Historical events, births, deaths or holidays for a calendar day, from Wikipedia's 'On this day'.",
    description="Returns what happened on a month/day across history (newest year first), each with the year, a "
    "one-line description and the main article. 'selected' is the curated short list; 'events', 'births' and "
    "'deaths' are the long lists (slower when not cached). It is keyed by calendar day, not by year: it will not "
    "list everything that happened in 1969. For one topic's history use wikipedia/summary or hako/answer.",
    categories=(Category.knowledge,),
    render=Render.table,
    price=LOCAL,
    example={"month": 7, "day": 20, "kind": "selected", "limit": 10},
    see_also=("wikipedia/summary", "hako/answer"),
    deadline_s=RUN_DEADLINE_MAX_S,  # an uncached long feed measured 6–8 s (2026-10-07)
    cache_ttl_s=TTL_PAGE_S,  # an empty input means "today", so a day-long cache would serve yesterday after midnight
)
async def on_this_day(inp: OnThisDayInput, ctx: RunContext) -> OnThisDayOutput:
    today = datetime.now(UTC).date()
    month, day = inp.month or today.month, inp.day or today.day
    path = f"/api/rest_v1/feed/onthisday/{inp.kind.value}/{month:02d}/{day:02d}"
    data = await wiki_get(ctx, inp.lang, path)
    items = data.get(inp.kind.value) or []
    if not items:
        raise ToolNotFoundResult(f"Wikipedia ({inp.lang}) has no '{inp.kind.value}' entries for {month}/{day}")
    return OnThisDayOutput(month=month, day=day, kind=inp.kind, total=len(items),
                           rows=[_otd_row(i) for i in items[: inp.limit]])
