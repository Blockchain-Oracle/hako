"""Crossref endpoints: one DOI's registered metadata (with update / retraction notices), and bibliographic search."""

import html
import re
from typing import Any, Self
from urllib.parse import quote

from pydantic import Field, field_validator, model_validator

from hako_tools.connectors.crossref.provider import CROSSREF
from hako_tools.constants import TTL_REFERENCE_S, TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool

ROWS_DEFAULT = 5
ROWS_MAX = 10
AUTHORS_SHOWN = 5
ABSTRACT_CHARS = 1_500
OLDEST_YEAR = 1600
NEWEST_YEAR = 2100
RETRACTION = "retraction"
_DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)?(10\.\d{4,9}/\S+)$", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")
SEARCH_SELECT = "DOI,title,author,container-title,publisher,published,type,is-referenced-by-count,URL,updated-by"


class Update(ToolOutput):
    type: str | None = None  # retraction, correction, expression_of_concern, …
    label: str | None = None
    doi: str | None = None
    date: str | None = None
    source: str | None = None  # "publisher" or "retraction-watch"


class Work(ToolOutput):
    doi: str
    title: str
    authors: str | None = None
    venue: str | None = None
    publisher: str | None = None
    type: str | None = None
    published: str | None = None
    year: int | None = None
    cited_by: int | None = None
    references: int | None = None
    url: str
    license: str | None = None
    abstract: str | None = None
    retracted: bool | None = None
    updated_by: list[Update] | None = None  # notices issued about this work
    updates: list[Update] | None = None  # works this record is itself a notice for


def _date(parts: dict[str, Any] | None) -> tuple[str | None, int | None]:
    first = ((parts or {}).get("date-parts") or [[]])[0]
    numbers = [int(p) for p in first if p is not None]
    if not numbers:
        return None, None
    year, *rest = numbers
    return "-".join([str(year), *(f"{n:02d}" for n in rest)]), year


def _authors(rows: list[dict[str, Any]]) -> str | None:
    names = [" ".join(p for p in (a.get("given"), a.get("family")) if p) or a.get("name") or "" for a in rows]
    names = [n for n in names if n]
    if not names:
        return None
    shown = ", ".join(names[:AUTHORS_SHOWN])
    return f"{shown} et al." if len(names) > AUTHORS_SHOWN else shown


def _updates(rows: list[dict[str, Any]] | None) -> list[Update] | None:
    if not rows:
        return None
    return [Update(type=r.get("type"), label=r.get("label"), doi=r.get("DOI"), date=_date(r.get("updated"))[0],
                   source=r.get("source")) for r in rows]


def _abstract(jats: str) -> str:
    """Abstracts arrive as JATS XML (<jats:p>…); keep the words, drop the markup and a leading 'Abstract'."""
    text = " ".join(html.unescape(_TAG.sub(" ", jats)).split())
    return text.removeprefix("Abstract ").removeprefix("ABSTRACT ")[:ABSTRACT_CHARS]


def _first(values: list[str] | None) -> str | None:
    return values[0] if values else None


def _work(msg: dict[str, Any], *, detail: bool = False) -> Work:
    published, year = _date(msg.get("published") or msg.get("issued"))
    updated_by = _updates(msg.get("updated-by"))
    abstract = msg.get("abstract")
    licences = msg.get("license") or []
    work = Work(
        doi=msg.get("DOI", ""),
        title=html.unescape(_first(msg.get("title")) or ""),
        authors=_authors(msg.get("author") or []),
        venue=_first(msg.get("container-title")),
        publisher=msg.get("publisher"),
        type=msg.get("type"),
        published=published,
        year=year,
        cited_by=msg.get("is-referenced-by-count"),
        url=msg.get("URL") or f"https://doi.org/{msg.get('DOI', '')}",
        retracted=any(u.type == RETRACTION for u in updated_by or []) or None,
        updated_by=updated_by,
    )
    if detail:
        work.references = msg.get("references-count")
        work.license = licences[0].get("URL") if licences else None
        work.abstract = _abstract(abstract) if abstract else None
        work.updates = _updates(msg.get("update-to"))
    return work


class WorkInput(ToolInput):
    doi: str = Field(min_length=7, max_length=300,
                     description="The DOI, e.g. '10.1038/nature14539' (https://doi.org/ and doi: prefixes are fine).")

    @field_validator("doi")
    @classmethod
    def _bare(cls, value: str) -> str:
        match = _DOI.match(value)
        if not match:
            raise ValueError("expected a DOI such as 10.1038/nature14539")
        return match.group(1)


class WorkOutput(ToolOutput):
    papers: list[Work]


@tool(
    provider=CROSSREF,
    slug="work",
    name="Crossref DOI Lookup",
    summary="The registered record for one DOI: title, authors, journal, date, type, citations, retraction notices.",
    description="Resolves a DOI against Crossref, the registry publishers deposit to, and returns its metadata "
    "plus any correction, retraction or expression-of-concern notices (from the publisher and Retraction Watch), "
    "so it is the check before citing a paper. An unregistered DOI answers found=false. DataCite DOIs (most "
    "datasets) are not in Crossref; try openalex/work. It returns no full text; use firecrawl/read-paper for that.",
    categories=(Category.research,),
    render=Render.papers,
    price=LOCAL,
    example={"doi": "10.1016/S0140-6736(97)11096-0"},
    see_also=("crossref/search", "openalex/work", "firecrawl/read-paper"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def work(inp: WorkInput, ctx: RunContext) -> WorkOutput:
    data = await ctx.get_json(CROSSREF, f"/works/{quote(inp.doi, safe='/')}")
    work_ = _work(data.get("message") or {}, detail=True)
    if work_.retracted:
        ctx.note("This work has been retracted; see updated_by for the notice.")
    return WorkOutput(papers=[work_])


class SearchInput(ToolInput):
    query: str = Field(min_length=2, max_length=500,
                       description="A citation or its parts: title words, author names, journal, year.")
    rows: int = Field(ROWS_DEFAULT, ge=1, le=ROWS_MAX)
    year_from: int | None = Field(None, ge=OLDEST_YEAR, le=NEWEST_YEAR)
    year_to: int | None = Field(None, ge=OLDEST_YEAR, le=NEWEST_YEAR)

    @model_validator(mode="after")
    def _years(self) -> Self:
        if self.year_from and self.year_to and self.year_from > self.year_to:
            raise ValueError("year_from must not be after year_to")
        return self


class SearchOutput(ToolOutput):
    query: str
    total: int | None = None
    papers: list[Work]


@tool(
    provider=CROSSREF,
    slug="search",
    name="Crossref Search",
    summary="Match a reference (title, authors, journal, year) to DOIs in Crossref's registry.",
    description="Bibliographic search: give it a citation string or title words and get the best-matching "
    "registered works with DOI, authors, venue, date, citation count and any retraction flag, best match first. "
    "Best for turning a reference into a DOI. It is not a topical discovery engine (any word can match, so sorting by "
    "citations would surface unrelated hits); for 'papers about X' use openalex/works or "
    "firecrawl/research-papers. Then crossref/work for one DOI's full record.",
    categories=(Category.research,),
    render=Render.papers,
    price=LOCAL,
    example={"query": "LeCun Bengio Hinton Deep learning Nature 2015", "rows": 3},
    see_also=("crossref/work", "openalex/works", "firecrawl/research-papers"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    params: dict[str, Any] = {"query.bibliographic": inp.query, "rows": inp.rows, "select": SEARCH_SELECT}
    filters = []
    if inp.year_from:
        filters.append(f"from-pub-date:{inp.year_from}")
    if inp.year_to:
        filters.append(f"until-pub-date:{inp.year_to}")
    if filters:
        params["filter"] = ",".join(filters)
    msg = (await ctx.get_json(CROSSREF, "/works", params=params)).get("message") or {}
    return SearchOutput(query=inp.query, total=msg.get("total-results"),
                        papers=[_work(row) for row in msg.get("items") or []])
