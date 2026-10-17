"""arXiv search: the query API's Atom feed parsed safely (defusedxml) into lean paper records."""

import re
from enum import StrEnum
from typing import Any
from xml.etree.ElementTree import Element

from defusedxml import ElementTree
from pydantic import Field

from hako_tools.connectors.arxiv.provider import ARXIV, ARXIV_ID
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import (
    LOCAL,
    Category,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)

RESULTS_DEFAULT = 5
RESULTS_MAX = 10
ABSTRACT_CHARS = 1_200
AUTHORS_SHOWN = 6
CATEGORIES_SHOWN = 5
COMMENT_CHARS = 200
ATOM = "{http://www.w3.org/2005/Atom}"
ARX = "{http://arxiv.org/schemas/atom}"
OPENSEARCH = "{http://a9.com/-/spec/opensearch/1.1/}"
ERROR_ID_MARK = "/api/errors"
CATEGORY_PATTERN = r"^[a-z][a-z-]*(\.[A-Za-z-]+)?$"  # cs.CL, astro-ph.GA, hep-th, q-bio.NC
# Field-prefixed queries (ti:, au:, abs:, cat:…) are passed through untouched for agents that know the syntax.
_FIELD_SYNTAX = re.compile(r"\b(ti|au|abs|co|jr|cat|rn|id|all):", re.IGNORECASE)
_TERM = re.compile(r"[\w.\-]+")
_ID_SEPARATORS = re.compile(r"[\s,]+")


class SortBy(StrEnum):
    relevance = "relevance"
    submitted = "submitted"  # newest submissions first
    updated = "updated"  # most recently revised first


_SORT = {SortBy.relevance: "relevance", SortBy.submitted: "submittedDate", SortBy.updated: "lastUpdatedDate"}


class SearchInput(ToolInput):
    query: str = Field(min_length=2, max_length=500,
                       description="Words to match in any field, arXiv syntax such as 'ti:transformer AND au:"
                       "vaswani', or arXiv ids ('2211.17192', 'arxiv:2211.17192v2', several comma-separated).")
    category: str | None = Field(None, max_length=20, pattern=CATEGORY_PATTERN,
                                 description="Restrict to an arXiv category, e.g. 'cs.CL' or 'astro-ph.GA'.")
    sort: SortBy = Field(SortBy.relevance, description="relevance, newest submitted, or most recently updated.")
    max_results: int = Field(RESULTS_DEFAULT, ge=1, le=RESULTS_MAX)


class Paper(ToolOutput):
    id: str  # e.g. 2411.18583v1
    title: str
    authors: str | None = None
    abstract: str | None = None
    published: str | None = None
    updated: str | None = None
    primary_category: str | None = None
    categories: list[str] | None = None
    url: str
    pdf_url: str | None = None
    doi: str | None = None
    journal_ref: str | None = None
    comment: str | None = None


class SearchOutput(ToolOutput):
    query: str
    total: int | None = None
    papers: list[Paper]


def _ids(query: str) -> list[str] | None:
    """The ids when the query is only arXiv ids (exact lookup, versions kept), else None."""
    tokens = [t for t in _ID_SEPARATORS.split(query.strip()) if t]
    if not tokens or len(tokens) > RESULTS_MAX or not all(ARXIV_ID.match(t) for t in tokens):
        return None
    return [t.split(":", 1)[-1] for t in tokens]


def _search_query(query: str, category: str | None) -> str:
    if _FIELD_SYNTAX.search(query):
        base = query
    else:  # every word must appear somewhere (title, abstract, authors, comments…)
        base = " AND ".join(f"all:{term}" for term in _TERM.findall(query)) or f"all:{query}"
    return f"({base}) AND cat:{category}" if category else base


def _text(entry: Element, tag: str) -> str | None:
    value = entry.findtext(tag)
    return " ".join(value.split()) if value else None


def _authors(entry: Element) -> str | None:
    names = [n for n in (a.findtext(f"{ATOM}name") for a in entry.findall(f"{ATOM}author")) if n]
    if not names:
        return None
    shown = ", ".join(names[:AUTHORS_SHOWN])
    return f"{shown} et al." if len(names) > AUTHORS_SHOWN else shown


def _paper(entry: Element) -> Paper:
    abs_url = _text(entry, f"{ATOM}id") or ""
    links: dict[str, Any] = {(link.get("title") or link.get("rel") or ""): link.get("href")
                             for link in entry.findall(f"{ATOM}link")}
    primary = entry.find(f"{ARX}primary_category")
    abstract, comment = _text(entry, f"{ATOM}summary"), _text(entry, f"{ARX}comment")
    return Paper(
        id=abs_url.rsplit("/abs/", 1)[-1],
        title=_text(entry, f"{ATOM}title") or "",
        authors=_authors(entry),
        abstract=abstract[:ABSTRACT_CHARS] if abstract else None,
        published=_text(entry, f"{ATOM}published"),
        updated=_text(entry, f"{ATOM}updated"),
        primary_category=primary.get("term") if primary is not None else None,
        categories=[c for c in (e.get("term") for e in entry.findall(f"{ATOM}category")) if c][:CATEGORIES_SHOWN],
        url=links.get("alternate") or abs_url.replace("http://", "https://"),
        pdf_url=links.get("pdf"),
        doi=_text(entry, f"{ARX}doi"),
        journal_ref=_text(entry, f"{ARX}journal_ref"),
        comment=comment[:COMMENT_CHARS] if comment else None,
    )


@tool(
    provider=ARXIV,
    slug="search",
    name="arXiv Search",
    summary="Search arXiv preprints by keywords, author or category; newest-first or by relevance.",
    description="Queries arXiv directly, so brand-new preprints appear the day they are announced. Returns id, "
    "title, authors, trimmed abstract, dates, categories, DOI/journal reference when published, and links to the "
    "abstract page and PDF (links only: arXiv's terms forbid redistributing the papers). Words are ANDed across all "
    "fields; arXiv syntax (ti:, au:, abs:, cat:) passes through; a query of arXiv ids alone ('2211.17192', "
    "'arxiv:2211.17192v2') looks those papers up exactly. arXiv allows one request every 3 s, so calls may queue "
    "briefly. For citation counts use openalex/work (it takes arXiv ids); for semantic search, passages inside a "
    "paper or related work use firecrawl/research-papers, firecrawl/read-paper and firecrawl/related-papers.",
    categories=(Category.research,),
    render=Render.papers,
    price=LOCAL,
    example={"query": "retrieval augmented generation", "category": "cs.CL", "sort": "submitted", "max_results": 5},
    see_also=("firecrawl/research-papers", "firecrawl/read-paper", "firecrawl/related-papers", "openalex/work"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    ids = _ids(inp.query)
    query = ",".join(ids) if ids else _search_query(inp.query, inp.category)
    params: dict[str, Any] = {"start": 0, "max_results": inp.max_results}
    if ids:
        params["id_list"] = query
    else:
        params |= {"search_query": query, "sortBy": _SORT[inp.sort], "sortOrder": "descending"}
    root = ElementTree.fromstring(await ctx.get_text(ARXIV, "/api/query", params=params))
    entries = root.findall(f"{ATOM}entry")
    if entries and ERROR_ID_MARK in (entries[0].findtext(f"{ATOM}id") or ""):
        raise ProviderError("arXiv rejected the query", details=[_text(entries[0], f"{ATOM}summary") or query])
    if ids and not entries:  # an exact lookup that matched nothing is not a result (and is never charged)
        raise ToolNotFoundResult(f"arXiv has no paper with id {query}")
    total = root.findtext(f"{OPENSEARCH}totalResults")
    return SearchOutput(query=query, total=int(total) if total and total.isdigit() else None,
                        papers=[_paper(e) for e in entries])
