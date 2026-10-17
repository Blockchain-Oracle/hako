"""hako/news (local GDELT headline index + live Hacker News) and hako/jobs (indexed public ATS boards)."""

from pydantic import Field

from hako_now.constants import JOBS_MAX_COMPANIES, JOBS_MAX_POSTED_WITHIN_DAYS, NEWS_MAX_LIMIT, NEWS_MAX_SINCE_HOURS
from hako_now.jobs.models import Job, JobsRequest
from hako_now.jobs.service import get_jobs
from hako_now.news.models import NewsRequest, NewsStory
from hako_now.news.service import get_news
from hako_tools.connectors.hako.bridge import call_now, call_now_sync, report
from hako_tools.connectors.hako.provider import HAKO
from hako_tools.constants import TTL_PAGE_S, TTL_SEARCH_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool


class NewsInput(ToolInput, NewsRequest):
    """Words to match; optionally how many hours back, a country mentioned (ISO code) and a limit."""


class NewsOutput(ToolOutput):
    query: str
    articles: list[NewsStory]
    unavailable: list[str] = Field(default_factory=list)


@tool(
    provider=HAKO,
    slug="news",
    name="Hako News Headlines",
    summary=f"Headlines from the last {NEWS_MAX_SINCE_HOURS} hours matching a query: GDELT's global feed and Hacker "
    "News, merged and de-duplicated.",
    description=f"Searches Hako's index of GDELT's 15-minute global news updates (English-language, last "
    f"{NEWS_MAX_SINCE_HOURS} h, ranked by match and recency) together with live Hacker News, removes duplicate "
    f"stories (same URL or near-identical headline, marked also_in), and returns up to {NEWS_MAX_LIMIT} with "
    "title, link, domain and when each source first saw it. Filter by a country mentioned (ISO code). Headlines "
    "and links only, never article text: read one with firecrawl/scrape or jina/read. If the index is not "
    "available the answer says so and carries the Hacker News results. For Google News results use serper/news.",
    categories=(Category.news,),
    render=Render.news,
    price=LOCAL,
    example={"query": "AI", "since_hours": 24, "limit": 5},
    see_also=("hackernews/search", "serper/news", "firecrawl/scrape"),
    cache_ttl_s=TTL_SEARCH_S,
)
async def news(inp: NewsInput, ctx: RunContext) -> NewsOutput:
    stories, sources, unavailable, notes = await call_now(get_news(inp))
    missing = report(ctx, sources, unavailable, notes)
    return NewsOutput(query=inp.query, articles=stories, unavailable=missing)


class JobsInput(ToolInput, JobsRequest):
    """Any mix of words, companies, location, remote, minimum stated salary and currency, age and limit."""


class JobsOutput(ToolOutput):
    jobs: list[Job]
    unavailable: list[str] = Field(default_factory=list)


@tool(
    provider=HAKO,
    slug="jobs",
    name="Hako Job Postings",
    summary="Open roles from the public job boards (Greenhouse, Lever, Ashby) of dozens of tech companies, "
    "filtered by words, company, location, remote and salary.",
    description="Searches Hako's index of company job boards on Greenhouse, Lever and Ashby, refreshed every "
    f"few hours (never fetched live): match words in the title or team, up to {JOBS_MAX_COMPANIES} companies, a "
    f"location, remote only, a minimum stated salary and currency, and postings from the last "
    f"{JOBS_MAX_POSTED_WITHIN_DAYS} days at most. Each job links to its own posting. Covers the indexed companies "
    "only, not the whole job market; salary filters only match postings that state a salary. When the index is "
    "empty the answer is an empty list with a note.",
    categories=(Category.jobs,),
    render=Render.jobs,
    price=LOCAL,
    example={"query": "engineer", "remote": True, "limit": 5},
    see_also=("hackernews/search", "serper/search"),
    cache_ttl_s=TTL_PAGE_S,
)
async def jobs(inp: JobsInput, ctx: RunContext) -> JobsOutput:
    found, sources, unavailable, notes = await call_now_sync(get_jobs, inp)
    missing = report(ctx, sources, unavailable, notes)
    return JobsOutput(jobs=found, unavailable=missing)
