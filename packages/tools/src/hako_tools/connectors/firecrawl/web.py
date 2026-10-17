"""Firecrawl web endpoints: search, scrape, map, ask-page."""

from enum import StrEnum
from typing import Any

from pydantic import Field, HttpUrl

from hako_tools.connectors.firecrawl.provider import FIRECRAWL
from hako_tools.constants import RUN_DEADLINE_MAX_S, TTL_PAGE_S, TTL_SEARCH_S
from hako_tools.framework import (
    PREMIUM,
    STANDARD,
    Category,
    Link,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)

SEARCH_LIMIT_MAX = 10  # one 2-credit block (2 credits per 10 results)
SEARCH_LIMIT_DEFAULT = 5
CONTENT_CHARS_PER_RESULT = 4_000  # with_content: keep each page short enough for several to fit
MAP_LIMIT_MAX = 200
MAP_LIMIT_DEFAULT = 50
# A site's sitemap answers in about 1 s; a full map (sitemap plus crawled links) of a cold site took 7–10 s
# (measured 2026-10-12). Sitemap-only mode ignores `search` (URLs come back alphabetical), so a search always uses
# the full map; without one the sitemap goes first. The full map gets Firecrawl's own timeout inside what is left.
MAP_CRAWL_SLACK_MS = 750  # Firecrawl stops this long before our deadline, so its MAP_TIMEOUT message reaches the caller
MAP_CRAWL_MIN_MS = 1_500  # less time than this left: skip a crawl that could not finish
MS_PER_S = 1000
HTTP_CLIENT_ERROR_MIN = 400  # the site itself answered 4xx/5xx: there is no page to return
PAGE_CACHE_MAX_AGE_MS = 86_400_000  # accept Firecrawl's own cached copy up to a day old (500% faster, same price)
QUESTION_MAX_CHARS = 500


class TimeRange(StrEnum):
    day = "day"
    week = "week"
    month = "month"
    year = "year"


_TBS = {TimeRange.day: "qdr:d", TimeRange.week: "qdr:w", TimeRange.month: "qdr:m", TimeRange.year: "qdr:y"}


class SearchSource(StrEnum):
    web = "web"
    news = "news"


class SearchInput(ToolInput):
    query: str = Field(min_length=1, max_length=500, description="What to search for, in plain words.")
    limit: int = Field(SEARCH_LIMIT_DEFAULT, ge=1, le=SEARCH_LIMIT_MAX, description="Results to return.")
    source: SearchSource = Field(SearchSource.web, description="web pages or news articles.")
    time_range: TimeRange | None = Field(None, description="Only results from the last day/week/month/year.")
    country: str | None = Field(None, min_length=2, max_length=2, description="ISO country code, e.g. 'us'.")
    with_content: bool = Field(False, description="Also return each result's page as markdown (costs more).")


class SearchResult(Link):
    content: str | None = None


class SearchOutput(ToolOutput):
    query: str
    results: list[SearchResult]


def _result(row: dict[str, Any], position: int, with_content: bool) -> SearchResult:
    content = row.get("markdown") if with_content else None
    return SearchResult(
        title=row.get("title") or row.get("url", ""),
        url=row.get("url", ""),
        snippet=(row.get("description") or row.get("snippet") or "")[:CONTENT_CHARS_PER_RESULT // 8] or None,
        published=row.get("date"),
        position=row.get("position", position),
        content=content[:CONTENT_CHARS_PER_RESULT] if content else None,
    )


@tool(
    provider=FIRECRAWL,
    slug="search",
    name="Firecrawl Web Search",
    summary="Search the live web or news and optionally get every result's page as markdown in the same call.",
    description="Live web or news search (not a cached index): titles, URLs and snippets, newest-first when a "
    "time range is set. Set with_content to receive each result's main content as markdown, which saves a "
    "separate scrape per page. For a single known URL use firecrawl/scrape; for a cited answer to a question "
    "use hako/answer; for cheaper plain Google results use serper/search.",
    categories=(Category.web_search, Category.news),
    render=Render.search_results,
    price=PREMIUM,
    example={"query": "solid-state battery startups", "limit": 5},
    see_also=("serper/search", "firecrawl/scrape", "hako/answer"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    body: dict[str, Any] = {"query": inp.query, "limit": inp.limit, "sources": [inp.source.value]}
    if inp.time_range:
        body["tbs"] = _TBS[inp.time_range]
    if inp.country:
        body["country"] = inp.country.upper()
    if inp.with_content:
        body["scrapeOptions"] = {"formats": ["markdown"], "onlyMainContent": True, "maxAge": PAGE_CACHE_MAX_AGE_MS}
    data = (await ctx.post_json(FIRECRAWL, "/v2/search", json=body)).get("data") or {}
    rows = data.get(inp.source.value) or []
    return SearchOutput(query=inp.query, results=[_result(r, i + 1, inp.with_content) for i, r in enumerate(rows)])


class ScrapeInput(ToolInput):
    url: HttpUrl = Field(description="The page to read.")
    main_content_only: bool = Field(True, description="Drop navigation, footers and ads.")


class PageOutput(ToolOutput):
    url: str
    title: str | None = None
    description: str | None = None
    language: str | None = None
    status_code: int | None = None
    markdown: str


def _first(value: Any) -> Any:
    return value[0] if isinstance(value, list) and value else value


@tool(
    provider=FIRECRAWL,
    slug="scrape",
    name="Firecrawl Scrape",
    summary="Turn any URL (including JavaScript-heavy pages and PDFs) into clean markdown.",
    description="Renders the page in a real browser and returns its main content as markdown with the title, "
    "description, language and the HTTP status the site answered. Works on single-page apps and PDFs. One page "
    "per call: to find pages first use firecrawl/map (one site) or firecrawl/search (the web). Very long pages are "
    "trimmed to Hako's size cap.",
    categories=(Category.web_extraction,),
    render=Render.page,
    price=STANDARD,
    example={"url": "https://en.wikipedia.org/wiki/Solid-state_battery"},
    see_also=("jina/read", "firecrawl/ask-page", "firecrawl/map"),
    cache_ttl_s=TTL_PAGE_S,
)
async def scrape(inp: ScrapeInput, ctx: RunContext) -> PageOutput:
    body = {"url": str(inp.url), "formats": ["markdown"], "onlyMainContent": inp.main_content_only,
            "maxAge": PAGE_CACHE_MAX_AGE_MS}
    data = (await ctx.post_json(FIRECRAWL, "/v2/scrape", json=body)).get("data") or {}
    meta = data.get("metadata") or {}
    status = meta.get("statusCode")
    # An error page or an empty render is not a page: answer not found, which is never billed.
    if not data.get("markdown") or (isinstance(status, int) and status >= HTTP_CLIENT_ERROR_MIN):
        raise ToolNotFoundResult(f"{inp.url} returned no readable page (HTTP {status or 'unknown'})")
    return PageOutput(
        url=meta.get("sourceURL") or meta.get("url") or str(inp.url),
        title=_first(meta.get("title") or meta.get("ogTitle")),
        description=_first(meta.get("description") or meta.get("ogDescription")),
        language=_first(meta.get("language")),
        status_code=meta.get("statusCode"),
        markdown=data.get("markdown") or "",
    )


class MapInput(ToolInput):
    url: HttpUrl = Field(description="Any page on the site to map.")
    search: str | None = Field(None, max_length=200, description="Only URLs relevant to these words.")
    limit: int = Field(MAP_LIMIT_DEFAULT, ge=1, le=MAP_LIMIT_MAX)


class MapOutput(ToolOutput):
    site: str
    links: list[Link]


@tool(
    provider=FIRECRAWL,
    slug="map",
    name="Firecrawl Site Map",
    summary="List the URLs on a website (optionally only those relevant to a few words), fast.",
    description="Discovers a site's URLs without scraping them, with titles where known; with search, the URLs "
    "most relevant to those words come first. Without search it reads the sitemap (about 1 s) and crawls only a "
    "site that has none. A first map of a large site can take up to 8 s and may time out (not charged): start "
    "from a narrower URL then. Use it to find the right page, then read that page with firecrawl/scrape.",
    categories=(Category.web_extraction,),
    render=Render.search_results,
    price=STANDARD,
    example={"url": "https://docs.firecrawl.dev", "search": "rate limits", "limit": 10},
    see_also=("firecrawl/scrape",),
    cache_ttl_s=TTL_PAGE_S,
    deadline_s=RUN_DEADLINE_MAX_S,
)
async def site_map(inp: MapInput, ctx: RunContext) -> MapOutput:
    body: dict[str, Any] = {"url": str(inp.url), "limit": inp.limit}
    links: list[Any] = []
    if inp.search:
        body["search"] = inp.search
    else:
        links = (await ctx.post_json(FIRECRAWL, "/v2/map", json={**body, "sitemap": "only"})).get("links") or []
    crawl_ms = round(ctx.deadline.remaining() * MS_PER_S) - MAP_CRAWL_SLACK_MS
    if not links and crawl_ms >= MAP_CRAWL_MIN_MS:
        links = (await ctx.post_json(FIRECRAWL, "/v2/map", json={**body, "timeout": crawl_ms})).get("links") or []
    return MapOutput(
        site=str(inp.url),
        links=[
            Link(title=(row.get("title") or row.get("url", "")) if isinstance(row, dict) else row,
                 url=row.get("url", "") if isinstance(row, dict) else row,
                 snippet=row.get("description") if isinstance(row, dict) else None)
            for row in links
        ],
    )


class AskPageInput(ToolInput):
    url: HttpUrl = Field(description="The page that holds the answer.")
    question: str = Field(min_length=3, max_length=QUESTION_MAX_CHARS, description="What you want to know.")


class AskPageOutput(ToolOutput):
    url: str
    question: str
    answer: str


@tool(
    provider=FIRECRAWL,
    slug="ask-page",
    name="Firecrawl Ask a Page",
    summary="Ask a question about one web page and get a short answer read from that page.",
    description="Reads the page in a browser and answers the question from its content only (it does not search "
    "the web). Good for 'what does this pricing page say about X'. For questions that need several sources use "
    "hako/answer.",
    categories=(Category.ai_answers, Category.web_extraction),
    render=Render.answer,
    price=PREMIUM,
    example={"url": "https://www.firecrawl.dev/pricing", "question": "How many credits does the free plan include?"},
    see_also=("hako/answer", "firecrawl/scrape"),
    cache_ttl_s=TTL_PAGE_S,
)
async def ask_page(inp: AskPageInput, ctx: RunContext) -> AskPageOutput:
    # docs.firecrawl.dev/features/scrape "Question format": 5 credits per page, answer in data.answer
    body = {"url": str(inp.url), "formats": [{"type": "question", "question": inp.question}],
            "maxAge": PAGE_CACHE_MAX_AGE_MS}
    data = (await ctx.post_json(FIRECRAWL, "/v2/scrape", json=body)).get("data") or {}
    answer = str(data.get("answer") or "").strip()
    if not answer:
        raise ToolNotFoundResult(f"{inp.url} could not be read to answer the question")
    return AskPageOutput(url=str(inp.url), question=inp.question, answer=answer)
