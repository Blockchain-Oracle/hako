"""Serper Google Scholar and Google Maps places."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.serper.common import GoogleInput, as_float, as_int, request_body
from hako_tools.connectors.serper.provider import SERPER
from hako_tools.constants import TTL_REFERENCE_S, TTL_SEARCH_S
from hako_tools.framework import STANDARD, Category, Render, RunContext, ToolOutput, tool

PLACES_QUERY_MAX_CHARS = 200
LOCATION_MAX_CHARS = 100
MAPS_CID_URL = "https://www.google.com/maps?cid={cid}"


class ScholarPaper(ToolOutput):
    title: str
    url: str | None = None
    publication_info: str | None = None  # "authors - venue, year - publisher", as Google Scholar prints it
    snippet: str | None = None
    year: int | None = None
    cited_by: int | None = None
    pdf_url: str | None = None
    scholar_id: str | None = None


class ScholarOutput(ToolOutput):
    query: str
    papers: list[ScholarPaper]


def _paper(row: dict[str, Any]) -> ScholarPaper:
    return ScholarPaper(title=row.get("title") or "", url=row.get("link"), publication_info=row.get("publicationInfo"),
                        snippet=row.get("snippet"), year=as_int(row.get("year")), cited_by=as_int(row.get("citedBy")),
                        pdf_url=row.get("pdfUrl"), scholar_id=row.get("id"))


@tool(
    provider=SERPER,
    slug="scholar",
    name="Serper Google Scholar",
    summary="Google Scholar results: paper titles, authors and venue, year, citation count and PDF links.",
    description="Searches Google Scholar by keyword and returns each paper's title, link, the author/venue line "
    "Scholar prints, year, how many times it is cited and a free PDF link when Scholar knows one. Keyword "
    "ranking, citation-weighted, no abstracts. For meaning-based search over abstracts use "
    "firecrawl/research-papers, then firecrawl/read-paper for the passages inside a paper.",
    categories=(Category.research,),
    render=Render.papers,
    price=STANDARD,
    example={"query": "retrieval augmented generation", "num": 5},
    see_also=("firecrawl/research-papers", "firecrawl/read-paper", "serper/search"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def scholar(inp: GoogleInput, ctx: RunContext) -> ScholarOutput:
    data = await ctx.post_json(SERPER, "/scholar", json=request_body(inp))
    rows = (data.get("organic") or [])[: inp.num]
    return ScholarOutput(query=inp.query, papers=[_paper(r) for r in rows if r.get("title")])


class PlacesInput(GoogleInput):
    query: str = Field(min_length=1, max_length=PLACES_QUERY_MAX_CHARS,
                       description="What to look for, e.g. 'coffee shops' or 'pharmacy open now'.")
    location: str | None = Field(None, min_length=2, max_length=LOCATION_MAX_CHARS,
                                 description="Where, in words: 'Lagos, Nigeria', 'Austin, Texas'. Without it, "
                                 "Google guesses from the query and country.")


class Place(ToolOutput):
    name: str
    address: str | None = None
    category: str | None = None
    rating: float | None = None
    rating_count: int | None = None
    price_level: str | None = None
    phone: str | None = None
    website: str | None = None
    lat: float | None = None
    lon: float | None = None
    maps_url: str | None = None
    position: int | None = None


class PlacesOutput(ToolOutput):
    query: str
    location: str | None = None
    places: list[Place]


def _place(row: dict[str, Any], position: int) -> Place:
    cid = row.get("cid")
    return Place(
        name=row.get("title") or "", address=row.get("address"), category=row.get("category"),
        rating=as_float(row.get("rating")), rating_count=as_int(row.get("ratingCount")),
        price_level=row.get("priceLevel"), phone=row.get("phoneNumber"), website=row.get("website"),
        lat=as_float(row.get("latitude")), lon=as_float(row.get("longitude")),
        maps_url=MAPS_CID_URL.format(cid=cid) if cid else None, position=as_int(row.get("position")) or position,
    )


@tool(
    provider=SERPER,
    slug="places",
    name="Serper Google Places",
    summary="Local businesses from Google Maps: name, address, rating, review count, category, phone, website, "
    "coordinates.",
    description="Finds businesses and points of interest the way Google Maps does: give what you want and, "
    "ideally, a location in words. Each place has its name, address, category, star rating and number of "
    "ratings, price level, phone, website, latitude/longitude and a Google Maps link. It does not return opening "
    "hours or reviews. To turn a city name into coordinates use openweather/geocode.",
    categories=(Category.places,),
    render=Render.place,
    price=STANDARD,
    example={"query": "coffee shops", "location": "Lagos, Nigeria", "num": 5},
    see_also=("openweather/geocode", "serper/search"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def places(inp: PlacesInput, ctx: RunContext) -> PlacesOutput:
    body = request_body(inp)
    if inp.location:
        body["location"] = inp.location
    data = await ctx.post_json(SERPER, "/places", json=body)
    rows = (data.get("places") or [])[: inp.num]  # Serper returns a full map page whatever num says
    return PlacesOutput(query=inp.query, location=inp.location,
                        places=[_place(r, i + 1) for i, r in enumerate(rows) if r.get("title")])
