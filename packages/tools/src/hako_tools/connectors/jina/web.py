"""Jina Reader (one URL → markdown) and Jina Search (web search with each result's page text).

Request options are headers (r.jina.ai/openapi.json, 2026-10-07). Measured on the dev box the same day: the
default browser engine took 16.7 s on an uncached blog post and the `direct` engine 0.85 s for identical text, so
`direct` is the default and the browser is opt-in for JavaScript-only pages.
"""

from typing import Any
from urllib.parse import urlparse

from pydantic import Field, HttpUrl

from hako_tools.connectors.jina.provider import JINA, JINA_SEARCH
from hako_tools.constants import TTL_PAGE_S, TTL_SEARCH_S
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

READ_TOKENS_MIN = 500  # Jina rejects X-Max-Tokens below 500
READ_TOKENS_MAX = 5_000  # ≈ 20k characters, Hako's cap for one string; Reader bills output tokens
READ_TIMEOUT_MAX_S = 7  # the run deadline is 8 s
JINA_TIMEOUT_MARGIN_S = 1.5  # Jina answers 422 "Timeout was reached" (no partial text) when its timeout fires;
# keeping it under our deadline turns a slow site into a clean provider error instead of a dropped run
SELECTOR_MAX_CHARS = 200
EMPTY_PAGE_CHARS = 200  # less text than this from the direct engine usually means a JavaScript-only page
PAGE_GONE = frozenset({404, 410})
SEARCH_QUERY_MAX_CHARS = 400
SEARCH_NUM_DEFAULT = 5
SEARCH_NUM_MAX = 10  # the API allows 20; Search bills a flat 10k tokens per query whatever the count
SEARCH_TOKENS_PER_RESULT = 1_000  # ≈ 4,000 characters of each result's page
CONTENT_CHARS_PER_RESULT = 4_000
COUNTRY_PATTERN = r"^[A-Za-z]{2}$"
LANGUAGE_PATTERN = r"^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$"
SITE_PATTERN = r"^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
SITE_MAX_CHARS = 253


def _timeout(ctx: RunContext, wanted: int | None) -> int:
    allowed = int(ctx.deadline.remaining() - JINA_TIMEOUT_MARGIN_S)
    return max(1, min(wanted or READ_TIMEOUT_MAX_S, allowed, READ_TIMEOUT_MAX_S))


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _host(url: str) -> str | None:
    return (urlparse(url).hostname or "").removeprefix("www.") or None


class ReadInput(ToolInput):
    url: HttpUrl = Field(description="The page or PDF to read.")
    render_js: bool = Field(False, description="Load the page in a headless browser first. Slower (often 5–15 s, "
                            "may hit the deadline); only for pages that show nothing without JavaScript.")
    keep_links: bool = Field(False, description="Keep hyperlinks as markdown links (default: link text only).")
    target_selector: str | None = Field(None, max_length=SELECTOR_MAX_CHARS,
                                        description="CSS selector: return only this part, e.g. 'article' or '#main'.")
    max_tokens: int = Field(READ_TOKENS_MAX, ge=READ_TOKENS_MIN, le=READ_TOKENS_MAX,
                            description="Cut the page after about this many tokens (4 characters each).")
    timeout_s: int | None = Field(None, ge=1, le=READ_TIMEOUT_MAX_S,
                                  description="Give up on a slow site after this many seconds (default: as long "
                                  "as the run deadline allows).")


class PageOutput(ToolOutput):
    url: str
    title: str | None = None
    description: str | None = None
    language: str | None = None
    published: str | None = None
    status_code: int | None = None
    markdown: str


@tool(
    provider=JINA,
    slug="read",
    name="Jina Reader",
    summary="Turn any URL (HTML page or PDF) into clean markdown with its title, language and publish date.",
    description="Fetches one URL and returns its main content as markdown without navigation, ads or images, "
    "plus title, description, language, published time and the HTTP status the site answered (404 or 410 comes "
    "back as found: false). Fast by default because it does not run JavaScript; set render_js for single-page "
    "apps. One URL per call and no search: find pages with serper/search, or get several results' text at once "
    "with jina/search. For a page that blocks plain fetchers, firecrawl/scrape renders it in a full browser.",
    categories=(Category.web_extraction,),
    render=Render.page,
    price=STANDARD,
    example={"url": "https://en.wikipedia.org/wiki/Transistor", "max_tokens": 2000},
    see_also=("jina/search", "firecrawl/scrape", "groq/summarize", "serper/search"),
    cache_ttl_s=TTL_PAGE_S,
)
async def read(inp: ReadInput, ctx: RunContext) -> PageOutput:
    headers = {
        "Accept": "application/json",
        "X-Retain-Images": "none",
        "X-Retain-Links": "all" if inp.keep_links else "text",
        "X-Engine": "browser" if inp.render_js else "direct",
        "X-Max-Tokens": str(inp.max_tokens),
        "X-Timeout": str(_timeout(ctx, inp.timeout_s)),
    }
    if inp.target_selector:
        headers["X-Target-Selector"] = inp.target_selector
    payload = await ctx.post_json(JINA, "/", json={"url": str(inp.url)}, headers=headers)
    data = payload.get("data") or {}
    status = _int(data.get("httpStatus"))
    if status in PAGE_GONE:
        raise ToolNotFoundResult(f"{inp.url} answered HTTP {status}")
    markdown = data.get("content") or ""
    if len(markdown.strip()) < EMPTY_PAGE_CHARS and not inp.render_js:
        ctx.note("Little text came back without JavaScript; retry with render_js=true if the page looks empty.")
    meta = data.get("metadata") or {}
    return PageOutput(
        url=data.get("url") or str(inp.url),
        title=data.get("title") or None,
        description=data.get("description") or None,
        language=meta.get("lang") if isinstance(meta, dict) else None,
        published=data.get("publishedTime"),
        status_code=status,
        markdown=markdown,
    )


class SearchInput(ToolInput):
    query: str = Field(min_length=1, max_length=SEARCH_QUERY_MAX_CHARS, description="What to search for.")
    num: int = Field(SEARCH_NUM_DEFAULT, ge=1, le=SEARCH_NUM_MAX, description="Results to return, each with text.")
    site: str | None = Field(None, pattern=SITE_PATTERN, max_length=SITE_MAX_CHARS,
                             description="Only results from this domain, e.g. 'docs.python.org'.")
    country: str | None = Field(None, pattern=COUNTRY_PATTERN, description="Two-letter country, e.g. 'us'.")
    language: str | None = Field(None, pattern=LANGUAGE_PATTERN, description="Result language, e.g. 'en'.")


class SearchResult(Link):
    content: str | None = None


class SearchOutput(ToolOutput):
    query: str
    results: list[SearchResult]


def _result(row: dict[str, Any], position: int) -> SearchResult:
    url = row.get("url", "")
    content = row.get("content") or None
    return SearchResult(title=row.get("title") or url, url=url, snippet=row.get("description") or None,
                        source=_host(url), published=row.get("date") or row.get("publishedTime"), position=position,
                        content=content[:CONTENT_CHARS_PER_RESULT] if content else None)


@tool(
    provider=JINA,
    slug="search",
    name="Jina Search",
    summary="Web search that returns the top results with each page's text as markdown, in one call.",
    description="Searches the web and reads every result for you: each result has its title, url, description "
    "and up to ~4,000 characters of the page's main text. Use it when you need to read several sources, not "
    "just pick one. Slower and dearer than plain search (Jina bills 10k tokens per query), so for links and "
    "snippets only use serper/search; for one known URL use jina/read; for a written, cited answer use "
    "hako/answer.",
    categories=(Category.web_search, Category.web_extraction),
    render=Render.search_results,
    price=PREMIUM,
    example={"query": "how do solid-state batteries work", "num": 3},
    see_also=("serper/search", "jina/read", "hako/answer"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    params: dict[str, Any] = {"q": inp.query, "num": inp.num}
    if inp.site:
        params["site"] = inp.site
    if inp.country:
        params["gl"] = inp.country.lower()
    if inp.language:
        params["hl"] = inp.language.lower()
    headers = {
        "Accept": "application/json",
        "X-Retain-Images": "none",
        "X-Retain-Links": "text",
        "X-Engine": "direct",
        "X-Max-Tokens": str(SEARCH_TOKENS_PER_RESULT),
        "X-Timeout": str(_timeout(ctx, None)),
    }
    payload = await ctx.get_json(JINA_SEARCH, "/search", params=params, headers=headers)
    rows = [r for r in payload.get("data") or [] if isinstance(r, dict) and r.get("url")]
    return SearchOutput(query=inp.query, results=[_result(r, i + 1) for i, r in enumerate(rows[: inp.num])])
