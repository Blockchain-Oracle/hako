"""Google News search and topic headlines: the RSS feeds parsed safely (defusedxml) into lean article records."""

from email.utils import parsedate_to_datetime
from enum import StrEnum
from xml.etree.ElementTree import Element

from defusedxml import ElementTree
from pydantic import Field

from hako_tools.connectors.googlenews.provider import GOOGLE_NEWS
from hako_tools.constants import TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

QUERY_MIN_CHARS = 2
QUERY_MAX_CHARS = 200
LIMIT_DEFAULT = 10
LIMIT_MAX = 30
COUNTRY_PATTERN = r"^[A-Za-z]{2}$"
LANGUAGE_PATTERN = r"^[a-z]{2}$"


class Recency(StrEnum):
    any = "any"
    day = "day"
    week = "week"
    month = "month"


# Google News' own search operator for recency
WHEN = {Recency.day: "when:1d", Recency.week: "when:7d", Recency.month: "when:30d"}


class Topic(StrEnum):
    top = "top"
    world = "world"
    nation = "nation"
    business = "business"
    technology = "technology"
    entertainment = "entertainment"
    sports = "sports"
    science = "science"
    health = "health"


class Article(ToolOutput):
    title: str
    url: str = Field(description="Google News link; it redirects to the publisher's article.")
    publisher: str | None = None
    publisher_url: str | None = None
    published: str | None = Field(None, description="ISO 8601, UTC.")


class NewsOutput(ToolOutput):
    query: str | None = None
    topic: str | None = None
    edition: str = Field(description="Country and language of the feed, e.g. 'US:en'.")
    articles: list[Article]


class Edition(ToolInput):
    country: str = Field("US", pattern=COUNTRY_PATTERN, description="ISO 3166-1 alpha-2 edition: US, GB, NG, IN…")
    language: str = Field("en", pattern=LANGUAGE_PATTERN, description="ISO 639-1 language: en, fr, es, pt, de…")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX)

    def params(self) -> dict[str, str]:
        country = self.country.upper()
        return {"hl": f"{self.language}-{country}", "gl": country, "ceid": f"{country}:{self.language}"}


def _iso(rfc822: str | None) -> str | None:
    try:
        return parsedate_to_datetime(rfc822).isoformat() if rfc822 else None
    except (TypeError, ValueError):
        return None


def _article(item: Element) -> Article | None:
    title, link = item.findtext("title"), item.findtext("link")
    if not title or not link:
        return None
    source = item.find("source")
    publisher = source.text.strip() if source is not None and source.text else None
    suffix = f" - {publisher}" if publisher else None
    if suffix and title.endswith(suffix):  # Google appends " - Publisher" to every headline
        title = title[: -len(suffix)]
    return Article(title=" ".join(title.split()), url=link.strip(), publisher=publisher,
                   publisher_url=source.get("url") if source is not None else None,
                   published=_iso(item.findtext("pubDate")))


async def _feed(ctx: RunContext, path: str, params: dict[str, str], limit: int) -> list[Article]:
    root = ElementTree.fromstring(await ctx.get_text(GOOGLE_NEWS, path, params=params))
    articles = [a for a in (_article(i) for i in root.iter("item")) if a is not None]
    return articles[:limit]


class SearchInput(Edition):
    query: str = Field(min_length=QUERY_MIN_CHARS, max_length=QUERY_MAX_CHARS,
                       description="Keywords; quotes and OR work as on Google: '\"MoonPay\" OR Coinbase'.")
    recency: Recency = Field(Recency.any, description="Only articles from the last day, week or month.")


@tool(
    provider=GOOGLE_NEWS,
    slug="search",
    name="Google News Search",
    summary="Search news from thousands of publishers by keyword, country, language and recency (keyless).",
    description="Searches Google News and returns up to 30 articles, newest and most relevant first: headline, "
    "publisher, publisher site, publication time and a link that redirects to the article. Filter by edition "
    "(country + language) and recency (day, week, month); Google's quotes and OR operators work. Headlines only, "
    "no article text: read one with jina/read or firecrawl/scrape. For Google's ranked news with snippets and "
    "images use serper/news; for tech-community discussion use hackernews/search.",
    categories=(Category.news,),
    render=Render.news,
    price=LOCAL,
    example={"query": "\"MoonPay\" OR Coinbase", "limit": 5},  # no recency filter: a one-month window can be empty
    see_also=("google-news/headlines", "serper/news", "jina/read"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def search(inp: SearchInput, ctx: RunContext) -> NewsOutput:
    query = f"{inp.query} {WHEN[inp.recency]}" if inp.recency in WHEN else inp.query
    articles = await _feed(ctx, "/rss/search", {"q": query, **inp.params()}, inp.limit)
    if not articles:
        raise ToolNotFoundResult(f"Google News has no articles for {inp.query!r}")
    return NewsOutput(query=inp.query, edition=inp.params()["ceid"], articles=articles)


class HeadlinesInput(Edition):
    topic: Topic = Field(Topic.top, description="top (front page) or a section: world, nation, business, "
                         "technology, entertainment, sports, science, health.")


@tool(
    provider=GOOGLE_NEWS,
    slug="headlines",
    name="Google News Headlines",
    summary="Today's top stories, or one section (business, technology, sports…), for any country edition.",
    description="The current Google News front page or one of its sections (world, nation, business, technology, "
    "entertainment, sports, science, health) for a country and language edition, up to 30 headlines with "
    "publisher and time. Use it for 'what's in the news in Nigeria today' or 'top tech stories'; to search a "
    "subject use google-news/search.",
    categories=(Category.news,),
    render=Render.news,
    price=LOCAL,
    example={"topic": "technology", "country": "US", "limit": 5},
    see_also=("google-news/search", "hako/news"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def headlines(inp: HeadlinesInput, ctx: RunContext) -> NewsOutput:
    path = "/rss" if inp.topic is Topic.top else f"/rss/headlines/section/topic/{inp.topic.value.upper()}"
    articles = await _feed(ctx, path, inp.params(), inp.limit)
    if not articles:
        raise ToolNotFoundResult(f"Google News has no {inp.topic.value} headlines for {inp.params()['ceid']}")
    return NewsOutput(topic=inp.topic.value, edition=inp.params()["ceid"], articles=articles)
