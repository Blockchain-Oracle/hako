"""hackernews/search: stories or comments matching a query, by relevance or newest first."""

import html
import re
import time
from enum import StrEnum
from typing import Any
from urllib.parse import urlsplit

from pydantic import Field

from hako_tools.connectors.hackernews.provider import HACKERNEWS
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Link, Render, RunContext, ToolInput, ToolOutput, tool

QUERY_MAX_CHARS = 200
LIMIT_DEFAULT = 10
LIMIT_MAX = 20
SINCE_DAYS_MAX = 3_650
SECONDS_PER_DAY = 86_400
TEXT_CHARS = 600  # a comment or Ask HN body: enough to judge relevance, not the whole thread
HN_ITEM = "https://news.ycombinator.com/item?id="
HN_DOMAIN = "news.ycombinator.com"
_TAG = re.compile(r"<[^>]+>")
_PARAGRAPH = re.compile(r"<p>", re.IGNORECASE)


class SortBy(StrEnum):
    relevance = "relevance"
    date = "date"


class ItemType(StrEnum):
    story = "story"
    comment = "comment"
    ask_hn = "ask_hn"
    show_hn = "show_hn"


_PATHS = {SortBy.relevance: "/api/v1/search", SortBy.date: "/api/v1/search_by_date"}


class SearchInput(ToolInput):
    query: str = Field(min_length=1, max_length=QUERY_MAX_CHARS, description="Words to find (exact spelling).")
    type: ItemType = Field(ItemType.story, description="story, comment, ask_hn or show_hn.")
    sort: SortBy = Field(SortBy.relevance, description="relevance (points weigh in) or date (newest first).")
    since_days: int | None = Field(None, ge=1, le=SINCE_DAYS_MAX, description="Only items from the last N days.")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX, description="Items to return.")


class HnItem(Link):
    kind: str
    hn_url: str
    author: str | None = None
    points: int | None = None
    num_comments: int | None = None
    story_title: str | None = None  # for comments: the story they belong to


class SearchOutput(ToolOutput):
    query: str
    total: int
    results: list[HnItem]


def _plain(text: str | None) -> str | None:
    if not text:
        return None
    flat = html.unescape(_TAG.sub("", _PARAGRAPH.sub("\n", text))).strip()
    return flat[:TEXT_CHARS] or None


def _item(hit: dict[str, Any], position: int) -> HnItem:
    hn_url = f"{HN_ITEM}{hit.get('objectID', '')}"
    is_comment = "comment" in (hit.get("_tags") or []) or hit.get("comment_text") is not None
    url = hn_url if is_comment else (hit.get("url") or hn_url)
    story_title = hit.get("story_title")
    title = hit.get("title") or (f"Comment on: {story_title}" if story_title else "Hacker News comment")
    return HnItem(
        title=title,
        url=url,
        snippet=_plain(hit.get("comment_text") or hit.get("story_text")),
        source=urlsplit(url).hostname or HN_DOMAIN,
        published=hit.get("created_at"),
        position=position,
        kind="comment" if is_comment else "story",
        hn_url=hn_url,
        author=hit.get("author"),
        points=hit.get("points"),
        num_comments=hit.get("num_comments"),
        story_title=story_title if is_comment else None,
    )


@tool(
    provider=HACKERNEWS,
    slug="search",
    name="Hacker News Search",
    summary="Search Hacker News stories, comments, Ask HN and Show HN posts by relevance or newest first.",
    description="Full-text search over all of Hacker News through Algolia, with typo tolerance off so results "
    "contain your exact words. Returns each item's title, link (the story's URL, or the HN thread for comments "
    "and text posts), points, comment count, author, time and HN link; comments and Ask HN bodies come as plain "
    f"text cut to {TEXT_CHARS} characters. Filter to the last N days or sort by date for 'what is HN saying "
    "now'. It does not fetch the linked article (use firecrawl/scrape or jina/read) and covers HN only; for "
    "general headlines use hako/news or serper/news.",
    categories=(Category.news, Category.developer),
    render=Render.search_results,
    price=LOCAL,
    example={"query": "sqlite", "type": "story", "sort": "relevance", "limit": 5},
    see_also=("hako/news", "serper/news", "firecrawl/scrape", "github/search-repos"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    params: dict[str, Any] = {"query": inp.query, "tags": inp.type.value, "hitsPerPage": inp.limit,
                              "typoTolerance": "false"}  # otherwise "election" also matches "Evictions"
    if inp.since_days:
        params["numericFilters"] = f"created_at_i>{int(time.time()) - inp.since_days * SECONDS_PER_DAY}"
    data = await ctx.get_json(HACKERNEWS, _PATHS[inp.sort], params=params)
    hits = (data.get("hits") or [])[: inp.limit]
    return SearchOutput(query=inp.query, total=data.get("nbHits") or 0,
                        results=[_item(h, i + 1) for i, h in enumerate(hits)])
