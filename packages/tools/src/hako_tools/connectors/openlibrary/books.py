"""openlibrary/search: book search, one row per work (all its editions folded together)."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.openlibrary.provider import OPENLIBRARY
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool

LIMIT_DEFAULT = 5
LIMIT_MAX = 10
AUTHORS_SHOWN = 3
LANGUAGES_SHOWN = 3
ISBN_SAMPLE = 3
ISBN13_LENGTH = 13
ENGLISH = "eng"
FIELDS = "key,title,subtitle,author_name,first_publish_year,edition_count,isbn,cover_i,language,ebook_access"
COVER_URL = "https://covers.openlibrary.org/b/id/{id}-M.jpg"


class SearchInput(ToolInput):
    query: str = Field(min_length=1, max_length=300, description="Title, author or subject words, or an ISBN.")
    author: str | None = Field(None, max_length=200, description="Only books by this author.")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX)


class BookRow(ToolOutput):
    title: str
    authors: str | None = None
    first_publish_year: int | None = None
    edition_count: int | None = None
    isbn: str | None = None  # a few ISBNs (13-digit first), comma-separated
    languages: str | None = None
    ebook: str | None = None  # public | borrowable | printdisabled | no_ebook
    cover_url: str | None = None
    url: str


class SearchOutput(ToolOutput):
    query: str
    total: int | None = None
    rows: list[BookRow]


def _book(doc: dict[str, Any]) -> BookRow:
    isbns = sorted(doc.get("isbn") or [], key=lambda i: len(i) != ISBN13_LENGTH)[:ISBN_SAMPLE]
    authors = doc.get("author_name") or []
    title = doc.get("title", "")
    subtitle = doc.get("subtitle")
    languages = sorted(doc.get("language") or [], key=lambda code: code != ENGLISH)  # MARC codes; English first
    return BookRow(
        title=f"{title}: {subtitle}" if subtitle else title,
        authors=", ".join(authors[:AUTHORS_SHOWN]) or None,
        first_publish_year=doc.get("first_publish_year"),
        edition_count=doc.get("edition_count"),
        isbn=", ".join(isbns) or None,
        languages=", ".join(languages[:LANGUAGES_SHOWN]) or None,
        ebook=doc.get("ebook_access"),
        cover_url=COVER_URL.format(id=doc["cover_i"]) if doc.get("cover_i") else None,
        url=f"https://openlibrary.org{doc.get('key', '')}",
    )


@tool(
    provider=OPENLIBRARY,
    slug="search",
    name="Open Library Book Search",
    summary="Search books: title, authors, first publication year, edition count, sample ISBNs and cover image.",
    description="Searches the Internet Archive's Open Library catalogue (tens of millions of works) by title, "
    "author or subject words, or an ISBN. Each row is a work with all editions folded in: authors, first publish "
    "year, number of editions, a few ISBNs, languages, whether an e-book can be read or borrowed, and a cover "
    "URL. It does not return book text or reviews; for scholarly papers use openalex/works or crossref/search.",
    categories=(Category.knowledge,),
    render=Render.table,
    price=LOCAL,
    example={"query": "the left hand of darkness", "limit": 3},
    see_also=("openalex/works", "wikipedia/summary"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    params: dict[str, Any] = {"q": inp.query, "limit": inp.limit, "fields": FIELDS}
    if inp.author:
        params["author"] = inp.author
    data = await ctx.get_json(OPENLIBRARY, "/search.json", params=params)
    return SearchOutput(query=inp.query, total=data.get("numFound"), rows=[_book(d) for d in data.get("docs") or []])
