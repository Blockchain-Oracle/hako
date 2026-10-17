"""OpenAlex endpoints: search works, look one work up by DOI or id, search authors."""

import re
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Self
from urllib.parse import quote

from pydantic import Field, field_validator, model_validator

from hako_tools.connectors.arxiv.provider import ARXIV_DOI_PREFIX, ARXIV_ID
from hako_tools.connectors.openalex.provider import OPENALEX
from hako_tools.constants import TTL_REFERENCE_S, TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool

K_DEFAULT = 5
K_MAX = 10
AUTHORS_SHOWN = 5  # first authors named; the rest become "et al."
ABSTRACT_CHARS = 1_500
OLDEST_YEAR = 1000
NEWEST_YEAR = 2100
_OPENALEX_ID = re.compile(r"^(?:https?://openalex\.org/)?([Ww]\d{1,12})$")
_FILTER_SYNTAX = re.compile(r"[,|]")
_DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)?(10\.\d{4,9}/\S+)$", re.IGNORECASE)
WORK_FIELDS = "id,doi,display_name,publication_year,publication_date,type,primary_location,cited_by_count,open_access"
SEARCH_FIELDS = f"{WORK_FIELDS},authorships"
DETAIL_FIELDS = f"{SEARCH_FIELDS},abstract_inverted_index,primary_topic,is_retracted,language,referenced_works_count"
AUTHOR_FIELDS = "id,display_name,orcid,works_count,cited_by_count,summary_stats,last_known_institutions,topics"
# OpenAlex keeps an arXiv preprint as its own record, often unlinked from the published version, and parses no
# reference list for it (arXiv:2211.17192, an ICML 2023 oral: 32 citations, 0 references on 2026-10-12).
ARXIV_PREPRINT_NOTE = (
    "OpenAlex has partial data for arXiv preprints: cited_by usually undercounts (citations to the published "
    "version may sit on another record) and references is often 0. For the papers that cite an arXiv paper use "
    "firecrawl/related-papers with mode 'citers'."
)


def _note_arxiv(ctx: RunContext, works: list["Work"]) -> None:
    if any((w.doi or "").lower().startswith(ARXIV_DOI_PREFIX) for w in works):
        ctx.note(ARXIV_PREPRINT_NOTE)


class Work(ToolOutput):
    id: str
    title: str
    authors: str | None = None
    year: int | None = None
    published: str | None = None
    venue: str | None = None
    type: str | None = None
    doi: str | None = None
    url: str
    cited_by: int | None = None
    open_access_url: str | None = None
    abstract: str | None = None
    topic: str | None = None
    is_retracted: bool | None = None
    references: int | None = None


def _short_id(url: str | None) -> str:
    return (url or "").rsplit("/", 1)[-1]


def _authors(authorships: list[dict[str, Any]]) -> str | None:
    names = [(a.get("author") or {}).get("display_name") for a in authorships]
    names = [n for n in names if n]
    if not names:
        return None
    shown = ", ".join(names[:AUTHORS_SHOWN])
    return f"{shown} et al." if len(names) > AUTHORS_SHOWN else shown


def _abstract(index: dict[str, list[int]] | None) -> str | None:
    """OpenAlex ships abstracts as an inverted index (word → positions); rebuild the text."""
    if not index:
        return None
    at = {pos: word for word, positions in index.items() for pos in positions}
    text = " ".join(at[i] for i in sorted(at))
    return text[:ABSTRACT_CHARS]


def _work(row: dict[str, Any], *, detail: bool = False) -> Work:
    location = row.get("primary_location") or {}
    doi_url = row.get("doi")
    work = Work(
        id=_short_id(row.get("id")),
        title=row.get("display_name") or "",
        authors=_authors(row.get("authorships") or []),
        year=row.get("publication_year"),
        published=row.get("publication_date"),
        venue=(location.get("source") or {}).get("display_name"),
        type=row.get("type"),
        doi=doi_url.removeprefix("https://doi.org/") if doi_url else None,
        url=doi_url or location.get("landing_page_url") or row.get("id", ""),
        cited_by=row.get("cited_by_count"),
        open_access_url=(row.get("open_access") or {}).get("oa_url"),
    )
    if detail:
        work.abstract = _abstract(row.get("abstract_inverted_index"))
        work.topic = (row.get("primary_topic") or {}).get("display_name")
        work.is_retracted = row.get("is_retracted")
        work.references = row.get("referenced_works_count")
    return work


class WorkSort(StrEnum):
    relevance = "relevance"
    most_cited = "most_cited"
    newest = "newest"


_SORT = {WorkSort.most_cited: "cited_by_count:desc", WorkSort.newest: "publication_date:desc"}


class WorksInput(ToolInput):
    query: str = Field(min_length=2, max_length=500, description="Words in the title, abstract or full text.")
    k: int = Field(K_DEFAULT, ge=1, le=K_MAX, description="Works to return.")
    sort: WorkSort = Field(WorkSort.relevance)
    year_from: int | None = Field(None, ge=OLDEST_YEAR, le=NEWEST_YEAR)
    year_to: int | None = Field(None, ge=OLDEST_YEAR, le=NEWEST_YEAR)
    open_access_only: bool = Field(False, description="Only works with a free full-text copy.")

    @model_validator(mode="after")
    def _years(self) -> Self:
        if self.year_from and self.year_to and self.year_from > self.year_to:
            raise ValueError("year_from must not be after year_to")
        return self


class WorksOutput(ToolOutput):
    query: str
    total: int | None = None
    papers: list[Work]


@tool(
    provider=OPENALEX,
    slug="works",
    name="OpenAlex Works Search",
    summary="Search 250M+ scholarly works: title, authors, year, venue, DOI, citation count and open-access link.",
    description="Keyword search over the titles and abstracts of papers, books, datasets and theses from every "
    "discipline, sortable by relevance, citations or date and filterable by year and open access. Each result "
    "carries an OpenAlex id and DOI for openalex/work (abstract, topic, retraction flag) or crossref/work. It ranks "
    "by keywords, not meaning: "
    "for semantic search over arXiv-style papers use firecrawl/research-papers; for newest preprints use "
    "arxiv/search. It does not return full text.",
    categories=(Category.research,),
    render=Render.papers,
    price=LOCAL,
    example={"query": "retrieval augmented generation", "k": 5},
    see_also=("openalex/work", "crossref/search", "arxiv/search", "firecrawl/research-papers"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def works(inp: WorksInput, ctx: RunContext) -> WorksOutput:
    params: dict[str, Any] = {"per_page": inp.k, "select": SEARCH_FIELDS}
    # Title + abstract only: plain `search` also matches full text, which floods "most cited" with SciPy-style
    # tool papers that merely mention the words. Commas and pipes are filter syntax, so they become spaces.
    filters = [f"title_and_abstract.search:{_FILTER_SYNTAX.sub(' ', inp.query)}"]
    if inp.year_from or inp.year_to:
        filters.append(f"publication_year:{inp.year_from or ''}-{inp.year_to or ''}")
    if inp.open_access_only:
        filters.append("is_oa:true")
    if inp.sort is WorkSort.newest:  # some records carry impossible future dates (a 2035 Zenodo upload, 2026-10)
        filters.append(f"to_publication_date:{datetime.now(UTC).date().isoformat()}")
    params["filter"] = ",".join(filters)
    if inp.sort in _SORT:
        params["sort"] = _SORT[inp.sort]
    data = await ctx.get_json(OPENALEX, "/works", params=params)
    papers = [_work(r) for r in data.get("results") or []]
    _note_arxiv(ctx, papers)
    return WorksOutput(query=inp.query, total=(data.get("meta") or {}).get("count"), papers=papers)


class WorkInput(ToolInput):
    id: str = Field(min_length=2, max_length=300,
                    description="A DOI ('10.1038/nature14539', with or without https://doi.org/), an OpenAlex "
                    "work id ('W2919115771') or an arXiv id ('2211.17192', 'arxiv:2211.17192v2').")

    @field_validator("id")
    @classmethod
    def _key(cls, value: str) -> str:
        value = value.strip()
        if match := _OPENALEX_ID.match(value):
            return match.group(1).upper()
        if match := _DOI.match(value):
            return f"doi:{match.group(1).lower()}"
        if match := ARXIV_ID.match(value):
            return f"doi:{ARXIV_DOI_PREFIX}{match.group(1).lower()}"
        raise ValueError("expected a DOI (10.xxxx/…), an OpenAlex work id (W…) or an arXiv id (2211.17192)")


class WorkOutput(ToolOutput):
    papers: list[Work]


@tool(
    provider=OPENALEX,
    slug="work",
    name="OpenAlex Work",
    summary="One scholarly work by DOI or OpenAlex id: metadata, abstract, topic, citations, retraction flag.",
    description="Looks up a single work by DOI, OpenAlex id or arXiv id and returns its title, authors, venue, date, "
    "type, citation and reference counts, primary topic, open-access link, a retraction flag and the abstract when "
    "OpenAlex has one (publishers withhold many). An unknown id answers found=false. arXiv preprints carry partial "
    "citation data (a note says so). For the publisher's own record (licence, update and retraction notices) use "
    "crossref/work; to read inside the paper use firecrawl/read-paper.",
    categories=(Category.research,),
    render=Render.papers,
    price=LOCAL,
    example={"id": "10.1038/nature14539"},
    see_also=("crossref/work", "openalex/works", "firecrawl/read-paper", "firecrawl/related-papers"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def work(inp: WorkInput, ctx: RunContext) -> WorkOutput:
    row = await ctx.get_json(OPENALEX, f"/works/{quote(inp.id, safe=':/')}", params={"select": DETAIL_FIELDS})
    papers = [_work(row, detail=True)]
    _note_arxiv(ctx, papers)
    return WorkOutput(papers=papers)


class AuthorsInput(ToolInput):
    query: str = Field(min_length=2, max_length=200, description="An author's name, e.g. 'Geoffrey Hinton'.")
    k: int = Field(K_DEFAULT, ge=1, le=K_MAX)


class AuthorRow(ToolOutput):
    id: str
    name: str
    orcid: str | None = None
    works_count: int | None = None
    cited_by: int | None = None
    h_index: int | None = None
    institution: str | None = None
    country: str | None = None
    top_topic: str | None = None
    url: str


class AuthorsOutput(ToolOutput):
    query: str
    total: int | None = None
    rows: list[AuthorRow]


def _author(row: dict[str, Any]) -> AuthorRow:
    institutions = row.get("last_known_institutions") or []
    first = institutions[0] if institutions else {}
    topics = row.get("topics") or []
    return AuthorRow(
        id=_short_id(row.get("id")),
        name=row.get("display_name") or "",
        orcid=row.get("orcid"),
        works_count=row.get("works_count"),
        cited_by=row.get("cited_by_count"),
        h_index=(row.get("summary_stats") or {}).get("h_index"),
        institution=first.get("display_name"),
        country=first.get("country_code"),
        top_topic=topics[0].get("display_name") if topics else None,
        url=row.get("id") or "",
    )


@tool(
    provider=OPENALEX,
    slug="authors",
    name="OpenAlex Authors Search",
    summary="Find researchers by name: works count, citations, h-index, last known institution and main topic.",
    description="Searches OpenAlex's disambiguated author profiles, so one person's papers are grouped under one "
    "id. Use the counts and institution to pick the right person among namesakes. It does not list the author's "
    "papers; search openalex/works with the author's name or a topic for that.",
    categories=(Category.research,),
    render=Render.table,
    price=LOCAL,
    example={"query": "Geoffrey Hinton", "k": 3},
    see_also=("openalex/works",),
    cache_ttl_s=TTL_SEARCH_S,
)
async def authors(inp: AuthorsInput, ctx: RunContext) -> AuthorsOutput:
    data = await ctx.get_json(OPENALEX, "/authors", params={"search": inp.query, "per_page": inp.k,
                                                            "select": AUTHOR_FIELDS})
    return AuthorsOutput(query=inp.query, total=(data.get("meta") or {}).get("count"),
                         rows=[_author(r) for r in data.get("results") or []])
