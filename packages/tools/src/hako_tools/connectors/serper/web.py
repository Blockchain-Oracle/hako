"""Serper Google web, news and image search."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.serper.common import (
    GoogleInput,
    TimedGoogleInput,
    as_int,
    host,
    request_body,
    web_url,
)
from hako_tools.connectors.serper.provider import SERPER
from hako_tools.constants import TTL_PAGE_S, TTL_SEARCH_S
from hako_tools.framework import STANDARD, Category, Link, Render, RunContext, ToolOutput, tool

PEOPLE_ALSO_ASK_MAX = 4
RELATED_SEARCHES_MAX = 6
ATTRIBUTES_MAX = 12


class AnswerBox(ToolOutput):
    answer: str | None = None
    snippet: str | None = None
    title: str | None = None
    url: str | None = None


class KnowledgePanel(ToolOutput):
    title: str
    type: str | None = None
    description: str | None = None
    website: str | None = None
    source_url: str | None = None
    attributes: dict[str, str] = Field(default_factory=dict)


class Question(ToolOutput):
    question: str
    snippet: str | None = None
    url: str | None = None


class SearchOutput(ToolOutput):
    query: str
    answer_box: AnswerBox | None = None
    knowledge_panel: KnowledgePanel | None = None
    results: list[Link]
    people_also_ask: list[Question] = Field(default_factory=list)
    related_searches: list[str] = Field(default_factory=list)


def _link(row: dict[str, Any], position: int) -> Link:
    url = row.get("link", "")
    return Link(title=row.get("title") or url, url=url, snippet=row.get("snippet"), source=host(url),
                published=row.get("date"), position=as_int(row.get("position")) or position)


def _answer_box(box: dict[str, Any] | None) -> AnswerBox | None:
    if not box:
        return None
    answer = box.get("answer") or box.get("snippet")
    return AnswerBox(answer=answer, snippet=box.get("snippet") if answer != box.get("snippet") else None,
                     title=box.get("title"), url=box.get("link")) if answer else None


def _knowledge(graph: dict[str, Any] | None) -> KnowledgePanel | None:
    if not graph or not graph.get("title"):
        return None
    attributes = {str(k): str(v) for k, v in list((graph.get("attributes") or {}).items())[:ATTRIBUTES_MAX]}
    return KnowledgePanel(title=graph["title"], type=graph.get("type"), description=graph.get("description"),
                          website=graph.get("website"), source_url=graph.get("descriptionLink"),
                          attributes=attributes)


@tool(
    provider=SERPER,
    slug="search",
    name="Serper Google Search",
    summary="Google web results as JSON: titles, links, snippets, plus the answer box and knowledge panel.",
    description="Runs a live Google search and returns the organic results (title, url, snippet, date) together "
    "with Google's own answer box and knowledge panel when it shows one, 'people also ask' questions and related "
    "searches. Snippets only: it does not open the pages. Read a result with jina/read; get every result's page "
    "text in one call with jina/search; for a written answer with citations use hako/answer.",
    categories=(Category.web_search,),
    render=Render.search_results,
    price=STANDARD,
    example={"query": "who invented the transistor", "num": 5},
    see_also=("hako/answer", "jina/read", "jina/search", "serper/news"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: TimedGoogleInput, ctx: RunContext) -> SearchOutput:
    data = await ctx.post_json(SERPER, "/search", json=request_body(inp))
    rows = data.get("organic") or []
    return SearchOutput(
        query=inp.query,
        answer_box=_answer_box(data.get("answerBox")),
        knowledge_panel=_knowledge(data.get("knowledgeGraph")),
        results=[_link(r, i + 1) for i, r in enumerate(rows[: inp.num])],
        people_also_ask=[Question(question=q["question"], snippet=q.get("snippet"), url=q.get("link"))
                         for q in (data.get("peopleAlsoAsk") or [])[:PEOPLE_ALSO_ASK_MAX] if q.get("question")],
        related_searches=[r["query"] for r in (data.get("relatedSearches") or [])[:RELATED_SEARCHES_MAX]
                          if r.get("query")],
    )


class Article(Link):
    image_url: str | None = None


class NewsOutput(ToolOutput):
    query: str
    articles: list[Article]


@tool(
    provider=SERPER,
    slug="news",
    name="Serper Google News",
    summary="Google News results: headline, publisher, how long ago, snippet and link.",
    description="Searches Google News live. Each article has its headline, link, publisher (source), a relative "
    "date such as '3 hours ago' and a snippet. Set time_range to 'day' for breaking stories. It returns "
    "headlines, not article bodies: open one with jina/read; for a cited summary of a story use hako/answer.",
    categories=(Category.news,),
    render=Render.news,
    price=STANDARD,
    example={"query": "solid-state battery", "num": 5, "time_range": "week"},
    see_also=("jina/read", "serper/search", "hako/answer"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def news(inp: TimedGoogleInput, ctx: RunContext) -> NewsOutput:
    data = await ctx.post_json(SERPER, "/news", json=request_body(inp))
    rows = (data.get("news") or [])[: inp.num]  # Serper returns at least 10 news rows whatever num says
    return NewsOutput(
        query=inp.query,
        articles=[
            Article(title=r.get("title") or r.get("link", ""), url=r.get("link", ""), snippet=r.get("snippet"),
                    source=r.get("source") or host(r.get("link")), published=r.get("date"),
                    position=as_int(r.get("position")) or i + 1, image_url=web_url(r.get("imageUrl")))
            for i, r in enumerate(rows)
        ],
    )


class ImageResult(Link):
    image_url: str
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None


class ImagesOutput(ToolOutput):
    query: str
    results: list[ImageResult]


@tool(
    provider=SERPER,
    slug="images",
    name="Serper Google Images",
    summary="Google Images results: direct image URL, thumbnail, size and the page it appears on.",
    description="Image search through Google. Each result has the full-size image_url, a thumbnail_url, the "
    "pixel size, the title and url of the page that hosts it, and that site's name. It does not download, "
    "describe or check the licence of images: check the hosting page before reusing one.",
    categories=(Category.web_search,),
    render=Render.search_results,
    price=STANDARD,
    example={"query": "golden gate bridge at night", "num": 5},
    see_also=("serper/search",),
    cache_ttl_s=TTL_PAGE_S,
)
async def images(inp: GoogleInput, ctx: RunContext) -> ImagesOutput:
    data = await ctx.post_json(SERPER, "/images", json=request_body(inp))
    results = []
    for i, r in enumerate((data.get("images") or [])[: inp.num]):
        image = web_url(r.get("imageUrl"))
        if not image:
            continue
        page = r.get("link") or image
        results.append(ImageResult(
            title=r.get("title") or page, url=page, source=r.get("source") or r.get("domain"),
            position=as_int(r.get("position")) or i + 1, image_url=image,
            thumbnail_url=web_url(r.get("thumbnailUrl")), width=as_int(r.get("imageWidth")),
            height=as_int(r.get("imageHeight")),
        ))
    return ImagesOutput(query=inp.query, results=results)
