"""Firecrawl's curated indexes: research papers, developer knowledge (issues, PRs, READMEs, docs), US government."""

from enum import StrEnum
from typing import Any

from pydantic import Field

from hako_tools.connectors.firecrawl.provider import FIRECRAWL
from hako_tools.constants import TTL_REFERENCE_S, TTL_SEARCH_S
from hako_tools.framework import STANDARD, Category, Link, Render, RunContext, ToolInput, ToolOutput, tool

PAPERS_K_DEFAULT = 8
PAPERS_K_MAX = 25  # the API allows 500; an agent rarely reads more than a page of abstracts
ABSTRACT_CHARS = 1_200
PASSAGES_DEFAULT = 4
PASSAGES_MAX = 12
INDEX_K_DEFAULT = 8
INDEX_K_MAX = 20
DEV_PASSAGES = 2


class Paper(ToolOutput):
    paper_id: str
    primary_id: str | None = None
    title: str
    abstract: str | None = None
    authors: str | None = None
    categories: list[str] | str | None = None
    created: str | None = None
    score: float | None = None
    url: str | None = None


def _paper_url(primary: str | None) -> str | None:
    if primary and primary.startswith("arxiv:"):
        return f"https://arxiv.org/abs/{primary.removeprefix('arxiv:')}"
    if primary and primary.startswith("doi:"):
        return f"https://doi.org/{primary.removeprefix('doi:')}"
    return None


def _paper(row: dict[str, Any]) -> Paper:
    primary = row.get("primaryId")
    abstract = row.get("abstract")
    return Paper(
        paper_id=str(row.get("paperId", "")),
        primary_id=primary,
        title=row.get("title", ""),
        abstract=abstract[:ABSTRACT_CHARS] if abstract else None,
        authors=row.get("authors"),
        categories=row.get("categories"),
        created=row.get("created") or row.get("createdAt"),
        score=row.get("score"),
        url=_paper_url(primary),
    )


class PapersInput(ToolInput):
    query: str = Field(min_length=2, max_length=500, description="Topic, method, benchmark or author.")
    k: int = Field(PAPERS_K_DEFAULT, ge=1, le=PAPERS_K_MAX, description="Papers to return.")
    authors: str | None = Field(None, max_length=200, description="Comma-separated author names to filter by.")
    published_from: str | None = Field(None, description="Earliest date, YYYY-MM-DD.")
    published_to: str | None = Field(None, description="Latest date, YYYY-MM-DD.")


class PapersOutput(ToolOutput):
    query: str
    papers: list[Paper]


@tool(
    provider=FIRECRAWL,
    slug="research-papers",
    name="Firecrawl Research Papers",
    summary="Semantic search over research papers (arXiv and more): ids, titles, abstracts and scores.",
    description="Ranks papers by meaning, not keywords, so 'why RAG models hallucinate' finds the right work. "
    "Each result has a paper_id usable with firecrawl/read-paper (passages inside the paper) and "
    "firecrawl/related-papers (similar, citing or cited work). For DOI metadata use crossref/work.",
    categories=(Category.research,),
    render=Render.papers,
    price=STANDARD,
    example={"query": "retrieval augmented generation hallucination detection", "k": 5},
    see_also=("firecrawl/read-paper", "firecrawl/related-papers", "openalex/works"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def research_papers(inp: PapersInput, ctx: RunContext) -> PapersOutput:
    params: dict[str, Any] = {"query": inp.query, "k": inp.k}
    if inp.authors:
        params["authors"] = inp.authors
    if inp.published_from:
        params["from"] = inp.published_from
    if inp.published_to:
        params["to"] = inp.published_to
    payload = await ctx.get_json(FIRECRAWL, "/v2/search/research/papers", params=params)
    return PapersOutput(query=inp.query, papers=[_paper(r) for r in payload.get("results") or []])


class ReadPaperInput(ToolInput):
    paper_id: str = Field(min_length=1, max_length=200, description="paper_id or primary id (e.g. arxiv:2510.21538).")
    question: str | None = Field(None, max_length=500, description="Return the passages that answer this.")
    passages: int = Field(PASSAGES_DEFAULT, ge=1, le=PASSAGES_MAX)


class Passage(ToolOutput):
    text: str
    score: float | None = None


class ReadPaperOutput(ToolOutput):
    paper: Paper
    passages: list[Passage] = Field(default_factory=list)


@tool(
    provider=FIRECRAWL,
    slug="read-paper",
    name="Firecrawl Read Paper",
    summary="Open one paper: its metadata, or the passages inside it that answer a question.",
    description="With only a paper_id it returns the paper's metadata. Add a question to get the in-body passages "
    "(text and tables) that answer it, scored by similarity — quote those rather than the abstract.",
    categories=(Category.research,),
    render=Render.papers,
    price=STANDARD,
    example={"paper_id": "arxiv:2510.21538", "question": "How is hallucination detected?"},
    see_also=("firecrawl/research-papers", "firecrawl/related-papers"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def read_paper(inp: ReadPaperInput, ctx: RunContext) -> ReadPaperOutput:
    params: dict[str, Any] = {}
    if inp.question:
        params = {"query": inp.question, "k": inp.passages}
    payload = await ctx.get_json(FIRECRAWL, f"/v2/search/research/papers/{inp.paper_id}", params=params)
    body = payload.get("result") or payload.get("paper") or payload
    rows = payload.get("passages") or body.get("passages") or []
    return ReadPaperOutput(
        paper=_paper(body),
        passages=[Passage(text=r.get("text", ""), score=r.get("score")) for r in rows if isinstance(r, dict)],
    )


class RelatedMode(StrEnum):
    similar = "similar"
    citers = "citers"
    references = "references"


# Firecrawl requires a ranking intent in plain words; without a caller's focus, each mode states its own.
_DEFAULT_INTENT = {
    RelatedMode.similar: "papers on the same problem using similar methods",
    RelatedMode.citers: "newer papers that build on, extend or evaluate this paper",
    RelatedMode.references: "the earlier work this paper builds on",
}


class RelatedInput(ToolInput):
    paper_id: str = Field(min_length=1, max_length=200, description="paper_id or primary id (e.g. arxiv:2211.17192).")
    mode: RelatedMode = Field(RelatedMode.similar, description="similar work, papers citing it, or its references.")
    focus: str | None = Field(None, min_length=2, max_length=300,
                              description="What to favour among the related papers, in plain words "
                              "(e.g. 'training better draft models').")
    k: int = Field(PAPERS_K_DEFAULT, ge=1, le=PAPERS_K_MAX)


class RelatedOutput(ToolOutput):
    paper_id: str
    mode: RelatedMode
    papers: list[Paper]


@tool(
    provider=FIRECRAWL,
    slug="related-papers",
    name="Firecrawl Related Papers",
    summary="Who cites a paper, what it cites, and similar papers (arXiv and more), ranked by meaning.",
    description="Expands from one paper (a paper_id from firecrawl/research-papers or an arXiv id such as "
    "arxiv:2211.17192) to its neighbourhood: 'similar' (by content), 'citers' (newer work that cites it) or "
    "'references' (what it cites), ranked by meaning. Add focus to favour one angle, e.g. 'training better draft "
    "models'. For a citation count use openalex/work.",
    categories=(Category.research,),
    render=Render.papers,
    price=STANDARD,
    example={"paper_id": "arxiv:2211.17192", "mode": "citers", "k": 5},
    see_also=("firecrawl/read-paper", "firecrawl/research-papers", "openalex/work"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def related_papers(inp: RelatedInput, ctx: RunContext) -> RelatedOutput:
    params = {"mode": inp.mode.value, "intent": inp.focus or _DEFAULT_INTENT[inp.mode], "k": inp.k}
    payload = await ctx.get_json(FIRECRAWL, f"/v2/search/research/papers/{inp.paper_id}/similar", params=params)
    return RelatedOutput(paper_id=inp.paper_id, mode=inp.mode, papers=[_paper(r) for r in payload.get("results") or []])


class DevType(StrEnum):
    doc = "doc"
    issue = "issue"
    pull_request = "pull_request"
    readme = "readme"


class DeveloperInput(ToolInput):
    query: str = Field(min_length=2, max_length=500,
                       description="A developer question, e.g. 'configure retries in httpx'.")
    types: list[DevType] | None = Field(None, description="Limit to docs, issues, merged PRs or READMEs.")
    language: str | None = Field(None, max_length=40, description="Repository language, e.g. 'Rust'.")
    k: int = Field(INDEX_K_DEFAULT, ge=1, le=INDEX_K_MAX)


class DevResult(Link):
    kind: str | None = None
    passages: list[str] = Field(default_factory=list)


class DeveloperOutput(ToolOutput):
    query: str
    results: list[DevResult]


@tool(
    provider=FIRECRAWL,
    slug="developer-search",
    name="Firecrawl Developer Search",
    summary="Search GitHub issues, merged pull requests, READMEs and curated docs, with the matching passages.",
    description="One index over public repositories (issues, merged PRs, READMEs) and documentation sites, each hit "
    "with the passage that matched, in markdown. Ideal for 'has anyone hit this error' and 'how do I configure X'. "
    "For package metadata use npm/package or pypi/package.",
    categories=(Category.developer,),
    render=Render.search_results,
    price=STANDARD,
    example={"query": "how to configure retries in httpx", "k": 5},
    see_also=("github/search-repos", "npm/package", "pypi/package"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def developer_search(inp: DeveloperInput, ctx: RunContext) -> DeveloperOutput:
    body: dict[str, Any] = {"query": inp.query, "k": inp.k, "passages": DEV_PASSAGES}
    if inp.types:
        body["types"] = [t.value for t in inp.types]
    if inp.language:
        body["language"] = inp.language
    payload = await ctx.post_json(FIRECRAWL, "/v2/search/developer", json=body)
    results = [
        DevResult(
            title=r.get("title") or r.get("url", ""),
            url=r.get("url", ""),
            kind=r.get("type") or (str(r.get("id", "")).split(":", 1)[0] or None),
            passages=[p.get("text", "") for p in r.get("passages") or [] if isinstance(p, dict)],
        )
        for r in payload.get("results") or []
    ]
    return DeveloperOutput(query=inp.query, results=results)


class GovInput(ToolInput):
    query: str = Field(min_length=2, max_length=500, description="A legal or regulatory question.")
    k: int = Field(INDEX_K_DEFAULT, ge=1, le=INDEX_K_MAX)


class GovOutput(ToolOutput):
    query: str
    results: list[Link]


@tool(
    provider=FIRECRAWL,
    slug="gov-search",
    name="Firecrawl Government Search",
    summary="Search US federal, state and local primary law: statutes, regulations, codes and court opinions.",
    description="Searches an index of government sources only (fda.gov, ecfr.gov, state codes, court opinions…), "
    "so results are primary material rather than law-firm blogs. US only. Not legal advice; read the source.",
    categories=(Category.government,),
    render=Render.search_results,
    price=STANDARD,
    example={"query": "food labeling requirements for allergens", "k": 5},
    see_also=("firecrawl/scrape",),
    cache_ttl_s=TTL_SEARCH_S,
)
async def gov_search(inp: GovInput, ctx: RunContext) -> GovOutput:
    payload = await ctx.get_json(FIRECRAWL, "/v2/search/gov", params={"query": inp.query, "k": inp.k})
    rows = (payload.get("data") or {}).get("web") or []
    return GovOutput(
        query=inp.query,
        results=[Link(title=r.get("title") or r.get("url", ""), url=r.get("url", ""), snippet=r.get("description"),
                      position=r.get("position")) for r in rows],
    )
