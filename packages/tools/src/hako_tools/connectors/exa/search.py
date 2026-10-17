"""exa/search (pages with their most relevant passages) and exa/answer (a short answer citing its sources)."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.exa.provider import EXA
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import (
    PREMIUM,
    Category,
    Citation,
    Link,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)

QUERY_MAX_CHARS = 500
RESULTS_DEFAULT = 8
RESULTS_MAX = 20
HIGHLIGHT_SENTENCES = 3
HIGHLIGHTS_PER_PAGE = 2
SNIPPET_CHARS = 400


class ExaSearchInput(ToolInput):
    query: str = Field(min_length=2, max_length=QUERY_MAX_CHARS,
                       description="A question or a description of the pages wanted ('startups building agent "
                       "wallets').")
    num_results: int = Field(RESULTS_DEFAULT, ge=1, le=RESULTS_MAX)


class ExaResult(Link):
    author: str | None = None
    passages: list[str] | None = None


class ExaSearchOutput(ToolOutput):
    query: str
    results: list[ExaResult]


@tool(
    provider=EXA,
    slug="search",
    name="Exa Search",
    summary="Meaning-based web search for agents: the best pages for a question, each with its most relevant passages.",
    description="Searches the web with Exa's neural index (it matches meaning, not just keywords) and returns up to 20 "
    "pages with title, URL, author, publication date and the 2 passages that best answer the query. Good for "
    "research questions and 'find companies / papers / posts like X'. For Google's ranking use serper/search; for a "
    "written answer with citations use exa/answer.",
    categories=(Category.web_search, Category.research),
    render=Render.search_results,
    price=PREMIUM,
    example={"query": "agent payments with x402", "num_results": 5},
    see_also=("exa/answer", "serper/search", "firecrawl/search"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: ExaSearchInput, ctx: RunContext) -> ExaSearchOutput:
    data = await ctx.post_json(EXA, "/search", json={
        "query": inp.query, "numResults": inp.num_results, "type": "auto",
        "contents": {"highlights": {"numSentences": HIGHLIGHT_SENTENCES, "highlightsPerUrl": HIGHLIGHTS_PER_PAGE}}})
    results: list[ExaResult] = []
    for i, row in enumerate((data or {}).get("results") or [], start=1):
        if not isinstance(row, dict) or not row.get("url"):
            continue
        passages = [str(h) for h in row.get("highlights") or []]
        snippet = (passages[0] if passages else str(row.get("text") or ""))[:SNIPPET_CHARS] or None
        results.append(ExaResult(title=str(row.get("title") or row["url"]), url=str(row["url"]), snippet=snippet,
                                 source=EXA.id, published=row.get("publishedDate"), position=i,
                                 author=row.get("author") or None, passages=passages or None))
    if not results:
        raise ToolNotFoundResult(f"Exa found no pages for {inp.query!r}")
    return ExaSearchOutput(query=inp.query, results=results)


class ExaAnswerInput(ToolInput):
    query: str = Field(min_length=3, max_length=QUERY_MAX_CHARS, description="The question to answer.")


class ExaAnswerOutput(ToolOutput):
    question: str
    answer: str
    citations: list[Citation]


def _citations(rows: list[Any]) -> list[Citation]:
    return [Citation(index=i, title=str(r.get("title") or r.get("url")), url=str(r["url"]))
            for i, r in enumerate((r for r in rows if isinstance(r, dict) and r.get("url")), start=1)]


@tool(
    provider=EXA,
    slug="answer",
    name="Exa Answer",
    summary="A short answer to a question, written by Exa from live web search, with numbered citations.",
    description="Asks Exa to search the web and write a short answer to one question, returning the answer and the "
    "pages it used as numbered citations (title and URL). Best for factual questions with a clear answer. For "
    "Hako's own cited answer built from Google results and page reads use hako/answer; for the pages themselves use "
    "exa/search.",
    categories=(Category.ai_answers, Category.web_search),
    render=Render.answer,
    price=PREMIUM,
    example={"query": "What is the x402 payment protocol?"},
    see_also=("exa/search", "hako/answer"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def answer(inp: ExaAnswerInput, ctx: RunContext) -> ExaAnswerOutput:
    data = await ctx.post_json(EXA, "/answer", json={"query": inp.query, "text": False})
    text = str((data or {}).get("answer") or "").strip()
    if not text:
        raise ToolNotFoundResult(f"Exa had no answer for {inp.query!r}")
    return ExaAnswerOutput(question=inp.query, answer=text, citations=_citations((data or {}).get("citations") or []))
