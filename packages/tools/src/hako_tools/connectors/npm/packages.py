"""npm/package: the latest version's document, last week's downloads and the latest publish time, in parallel."""

import asyncio
import re
from collections.abc import Awaitable
from typing import Any

from pydantic import Field

from hako_tools.connectors.npm.provider import NPM, NPM_DOWNLOADS
from hako_tools.constants import TTL_PAGE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool
from hako_tools.framework.errors import ToolError

# validate-npm-package-name: ≤ 214 characters, URL-safe, optional @scope/ (old packages may use capitals).
NAME_PATTERN = r"^(?:@[A-Za-z0-9._~-]+/)?[A-Za-z0-9._~-]+$"
NAME_MAX_CHARS = 214
# The registry's search ranks an exact name first; a few hits cover near-identical names. Its `date` field is the
# only cheap source of the latest publish time (the full document with `time` runs to megabytes).
SEARCH_SIZE = 5
DESCRIPTION_CHARS = 500
_SHORTHAND_HOSTS = {"github": "github.com", "gitlab": "gitlab.com", "bitbucket": "bitbucket.org"}
_SHORTHAND = re.compile(r"^(?:(?P<kind>github|gitlab|bitbucket):)?(?P<path>[\w.-]+/[\w.-]+)$")
_REPO_URL = re.compile(r"^(?:git\+)?(?:[a-z]+://)?(?:[^@/]+@)?(?P<host>[^/:@]+)[:/](?P<path>.+?)(?:\.git)?/?$")


class PackageInput(ToolInput):
    name: str = Field(min_length=1, max_length=NAME_MAX_CHARS, pattern=NAME_PATTERN,
                      description="npm package name, e.g. 'express' or '@types/node'.")


class PackageOutput(ToolOutput):
    name: str
    version: str
    description: str | None = None
    license: str | None = None
    homepage: str | None = None
    repository: str | None = None
    npm_url: str
    maintainers: int = 0
    dependencies: int = 0
    engines: dict[str, str] | None = None
    latest_published_at: str | None = None
    deprecated: str | None = None
    weekly_downloads: int | None = None
    downloads_period: str | None = None


def _licence(doc: dict[str, Any]) -> str | None:
    lic = doc.get("license") or doc.get("licenses")
    if isinstance(lic, list):
        lic = " OR ".join(str(x.get("type", x) if isinstance(x, dict) else x) for x in lic) or None
    if isinstance(lic, dict):
        lic = lic.get("type")
    return str(lic) if lic else None


def _repository(doc: dict[str, Any]) -> str | None:
    """Normalise npm's many repository spellings (git+https, git+ssh, git@host:, github:, owner/repo) to https."""
    repo = doc.get("repository")
    url = repo.get("url") if isinstance(repo, dict) else repo
    if not isinstance(url, str) or not url.strip():
        return None
    url = url.strip()
    if (shorthand := _SHORTHAND.match(url)) is not None:
        host = _SHORTHAND_HOSTS[shorthand["kind"] or "github"]
        return f"https://{host}/{shorthand['path'].removesuffix('.git')}"
    if (full := _REPO_URL.match(url)) is not None:
        return f"https://{full['host']}/{full['path']}"
    return url


async def _optional(call: Awaitable[Any]) -> Any:
    """Downloads and publish time are extras: their failure must not fail the lookup."""
    try:
        return await call
    except (ToolError, ToolNotFoundResult):
        return None


def _published_at(search: Any, name: str) -> str | None:
    for row in (search or {}).get("objects") or []:
        pkg = row.get("package") or {}
        if pkg.get("name") == name:
            return pkg.get("date")
    return None


@tool(
    provider=NPM,
    slug="package",
    name="npm Package",
    summary="An npm package's latest version, licence, repository, deprecation notice and weekly downloads.",
    description="Reads the registry's document for the package's `latest` dist-tag and returns its version, "
    "description, licence, homepage, repository URL, maintainer and dependency counts, required engines (Node "
    "version), the deprecation message if the latest version is deprecated, plus last week's download count and "
    "the latest publish time when npm reports them. It does not list every version or audit dependencies: use "
    "depsdev/package for version history and depsdev/version for licences and security advisories; use "
    "github/repo for the repository's activity.",
    categories=(Category.developer,),
    render=Render.package,
    price=LOCAL,
    example={"name": "express"},
    see_also=("depsdev/package", "depsdev/version", "github/repo", "pypi/package"),
    cache_ttl_s=TTL_PAGE_S,
)
async def package(inp: PackageInput, ctx: RunContext) -> PackageOutput:
    encoded = inp.name.replace("/", "%2F")  # the registry wants a scoped name as one path segment
    doc, downloads, search = await asyncio.gather(
        ctx.get_json(NPM, f"/{encoded}/latest"),
        _optional(ctx.get_json(NPM_DOWNLOADS, f"/downloads/point/last-week/{inp.name}")),
        _optional(ctx.get_json(NPM, "/-/v1/search", params={"text": inp.name, "size": SEARCH_SIZE})),
        return_exceptions=True,
    )
    if isinstance(doc, BaseException):
        raise doc
    if not isinstance(doc, dict) or not doc.get("version"):
        raise ToolNotFoundResult(f"npm has no published version of {inp.name}")
    published = _published_at(search, inp.name)
    if downloads is None:
        ctx.note("npm's download-count API did not answer; weekly_downloads is missing.")
    deprecated, engines = doc.get("deprecated"), doc.get("engines")
    description = doc.get("description")
    return PackageOutput(
        name=doc.get("name") or inp.name,
        version=doc["version"],
        description=description[:DESCRIPTION_CHARS] if isinstance(description, str) else None,
        license=_licence(doc),
        homepage=doc.get("homepage") if isinstance(doc.get("homepage"), str) else None,
        repository=_repository(doc),
        npm_url=f"https://www.npmjs.com/package/{inp.name}",
        maintainers=len(doc.get("maintainers") or []),
        dependencies=len(doc.get("dependencies") or {}),
        engines={str(k): str(v) for k, v in engines.items()} if isinstance(engines, dict) and engines else None,
        latest_published_at=published,
        deprecated=deprecated if isinstance(deprecated, str) and deprecated else None,
        weekly_downloads=downloads.get("downloads") if isinstance(downloads, dict) else None,
        downloads_period=f"{downloads['start']}..{downloads['end']}"
        if isinstance(downloads, dict) and downloads.get("start") and downloads.get("end") else None,
    )
