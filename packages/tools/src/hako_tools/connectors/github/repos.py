"""GitHub repository endpoints: one repository, repository search, and its latest release."""

import re
from enum import StrEnum
from typing import Any

from pydantic import Field, field_validator

from hako_tools.connectors.github.provider import GITHUB, GITHUB_HEADERS
from hako_tools.constants import TTL_PAGE_S
from hako_tools.framework import (
    LOCAL,
    Category,
    Link,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)
from hako_tools.framework.errors import ProviderRateLimited

# GitHub names: owners are ≤ 39 alphanumerics or hyphens, repositories ≤ 100 of [A-Za-z0-9._-].
REPO_PATTERN = r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$"
_URL_PREFIX = re.compile(r"^(?:https?://)?(?:www\.)?github\.com/", re.IGNORECASE)
SEARCH_QUERY_MAX_CHARS = 256  # GitHub rejects longer search queries
SEARCH_LIMIT_MAX = 10
SEARCH_LIMIT_DEFAULT = 5
RELEASE_BODY_CHARS = 2_000  # release notes can run to tens of KB; the opening is the summary
HTTP_FORBIDDEN = 403  # GitHub's answer when the keyless hourly budget is spent
RATE_LIMITED_MESSAGE = (
    "GitHub's rate limit for Hako is spent (60 calls/hour without a token); retry later, or use "
    "firecrawl/developer-search for issues and READMEs"
)


async def _get(ctx: RunContext, path: str, params: dict[str, Any] | None = None) -> Any:
    try:
        return await ctx.get_json(GITHUB, path, params=params, headers=GITHUB_HEADERS)
    except ProviderError as exc:
        if f"HTTP {HTTP_FORBIDDEN}" in exc.message:  # GitHub answers 403 (not 429) when the primary limit is hit
            raise ProviderRateLimited(RATE_LIMITED_MESSAGE) from exc
        raise


class RepoInput(ToolInput):
    repo: str = Field(pattern=REPO_PATTERN, description="owner/name, e.g. 'encode/httpx' (a github.com URL works).")

    @field_validator("repo", mode="before")
    @classmethod
    def _strip_url(cls, value: Any) -> Any:
        if isinstance(value, str):
            return _URL_PREFIX.sub("", value.strip()).removesuffix(".git").strip("/")
        return value


class RepoOutput(ToolOutput):
    full_name: str
    url: str
    description: str | None = None
    stars: int
    forks: int
    open_issues: int  # GitHub counts open pull requests in this number too
    license: str | None = None
    default_branch: str | None = None
    language: str | None = None
    topics: list[str] = Field(default_factory=list)
    homepage: str | None = None
    archived: bool = False
    fork: bool = False
    created_at: str | None = None
    pushed_at: str | None = None


def _licence(row: dict[str, Any]) -> str | None:
    lic = row.get("license") or {}
    spdx = lic.get("spdx_id")
    return spdx if spdx and spdx != "NOASSERTION" else lic.get("name")


@tool(
    provider=GITHUB,
    slug="repo",
    name="GitHub Repository",
    summary="One public GitHub repository: description, stars, forks, open issues, licence, topics, last push.",
    description="Looks up a public repository by owner/name and returns what an agent needs to judge it: "
    "description, stars, forks, open issues (GitHub includes open pull requests in that count), SPDX licence, "
    "default branch, main language, topics, homepage, whether it is archived or a fork, and when it was created "
    "and last pushed. It does not read files, issues or the README: use firecrawl/developer-search for those, "
    "and github/latest-release for the newest release notes. Private repositories answer not found.",
    categories=(Category.developer,),
    render=Render.package,
    price=LOCAL,
    example={"repo": "encode/httpx"},
    see_also=("github/latest-release", "github/search-repos", "firecrawl/developer-search", "depsdev/package"),
    cache_ttl_s=TTL_PAGE_S,
)
async def repo(inp: RepoInput, ctx: RunContext) -> RepoOutput:
    row = await _get(ctx, f"/repos/{inp.repo}")
    return RepoOutput(
        full_name=row.get("full_name") or inp.repo,
        url=row.get("html_url") or f"https://github.com/{inp.repo}",
        description=row.get("description"),
        stars=row.get("stargazers_count") or 0,
        forks=row.get("forks_count") or 0,
        open_issues=row.get("open_issues_count") or 0,
        license=_licence(row),
        default_branch=row.get("default_branch"),
        language=row.get("language"),
        topics=row.get("topics") or [],
        homepage=row.get("homepage") or None,
        archived=bool(row.get("archived")),
        fork=bool(row.get("fork")),
        created_at=row.get("created_at"),
        pushed_at=row.get("pushed_at"),
    )


class RepoSort(StrEnum):
    best_match = "best-match"
    stars = "stars"
    updated = "updated"


class SearchInput(ToolInput):
    query: str = Field(min_length=1, max_length=SEARCH_QUERY_MAX_CHARS,
                       description="Words to match in names, descriptions and topics; GitHub qualifiers such as "
                       "'topic:cli' or 'stars:>1000' work too.")
    language: str | None = Field(None, max_length=40, description="Only repositories in this language, e.g. 'Rust'.")
    sort: RepoSort = Field(RepoSort.best_match, description="best-match, most stars, or most recently updated.")
    limit: int = Field(SEARCH_LIMIT_DEFAULT, ge=1, le=SEARCH_LIMIT_MAX, description="Repositories to return.")


class RepoHit(Link):
    stars: int = 0
    forks: int = 0
    language: str | None = None
    pushed_at: str | None = None
    archived: bool = False


class SearchOutput(ToolOutput):
    query: str
    total_count: int
    results: list[RepoHit]


@tool(
    provider=GITHUB,
    slug="search-repos",
    name="GitHub Repository Search",
    summary="Find public GitHub repositories by keywords, language and qualifiers, sorted by match, stars or update.",
    description="Searches GitHub's repository index (names, descriptions, topics, README text) and returns up to "
    f"{SEARCH_LIMIT_MAX} repositories with stars, forks, language and last push. Accepts GitHub search qualifiers "
    "('topic:', 'stars:>', 'pushed:>2026-01-01'). It finds repositories, not code or issues: for 'how do I' and "
    "error-message questions use firecrawl/developer-search; to open one result use github/repo.",
    categories=(Category.developer,),
    render=Render.search_results,
    price=LOCAL,
    example={"query": "http client", "language": "Python", "sort": "stars", "limit": 5},
    see_also=("github/repo", "firecrawl/developer-search", "npm/package", "pypi/package"),
    cache_ttl_s=TTL_PAGE_S,
)
async def search_repos(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    q = f"{inp.query} language:{inp.language}" if inp.language else inp.query
    params: dict[str, Any] = {"q": q, "per_page": inp.limit}
    if inp.sort is not RepoSort.best_match:
        params |= {"sort": inp.sort.value, "order": "desc"}
    data = await _get(ctx, "/search/repositories", params)
    if data.get("incomplete_results"):
        ctx.note("GitHub timed out part of this search; the list may be incomplete.")
    hits = [
        RepoHit(
            title=r.get("full_name", ""),
            url=r.get("html_url", ""),
            snippet=r.get("description"),
            position=i + 1,
            stars=r.get("stargazers_count") or 0,
            forks=r.get("forks_count") or 0,
            language=r.get("language"),
            pushed_at=r.get("pushed_at"),
            archived=bool(r.get("archived")),
        )
        for i, r in enumerate((data.get("items") or [])[: inp.limit])
    ]
    return SearchOutput(query=inp.query, total_count=data.get("total_count") or 0, results=hits)


class ReleaseOutput(ToolOutput):
    repo: str
    tag: str
    name: str | None = None
    published_at: str | None = None
    prerelease: bool = False
    url: str | None = None
    body: str | None = None


@tool(
    provider=GITHUB,
    slug="latest-release",
    name="GitHub Latest Release",
    summary="The newest published (non-draft, non-prerelease) release of a GitHub repository, with its notes.",
    description="Returns the repository's latest full release as GitHub defines it (drafts and prereleases are "
    f"skipped): tag, title, publish time, link and the first {RELEASE_BODY_CHARS:,} characters of the release "
    "notes. Repositories that only push git tags, never Releases, answer not found: check npm/package or "
    "pypi/package for the latest published version instead.",
    categories=(Category.developer,),
    render=Render.package,
    price=LOCAL,
    example={"repo": "astral-sh/uv"},
    see_also=("github/repo", "npm/package", "pypi/package", "depsdev/package"),
    cache_ttl_s=TTL_PAGE_S,
)
async def latest_release(inp: RepoInput, ctx: RunContext) -> ReleaseOutput:
    try:
        row = await _get(ctx, f"/repos/{inp.repo}/releases/latest")
    except ToolNotFoundResult as nf:
        raise ToolNotFoundResult(f"{inp.repo} has no published release (or the repository does not exist)") from nf
    body = row.get("body") or ""
    return ReleaseOutput(
        repo=inp.repo,
        tag=row.get("tag_name", ""),
        name=row.get("name") or None,
        published_at=row.get("published_at"),
        prerelease=bool(row.get("prerelease")),
        url=row.get("html_url"),
        body=body[:RELEASE_BODY_CHARS] or None,
    )
