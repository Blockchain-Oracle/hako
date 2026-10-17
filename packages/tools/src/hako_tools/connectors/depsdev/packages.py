"""deps.dev package and version endpoints (GetPackage, GetVersion)."""

import re
from enum import StrEnum
from typing import Any
from urllib.parse import quote

from pydantic import Field

from hako_tools.connectors.depsdev.provider import DEPSDEV
from hako_tools.constants import TTL_PAGE_S, TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool
from hako_tools.framework.errors import ToolError

NAME_MAX_CHARS = 300  # Maven group:artifact and Go module paths are long
VERSION_MAX_CHARS = 128
RECENT_VERSIONS = 5
MAX_ADVISORIES = 25
MAX_RELATED = 10
_PEP503_RUN = re.compile(r"[-_.]+")


class System(StrEnum):
    npm = "npm"
    pypi = "pypi"
    go = "go"
    cargo = "cargo"
    maven = "maven"
    nuget = "nuget"
    rubygems = "rubygems"


def _name(system: System, name: str) -> str:
    """deps.dev's spelling: PyPI names PEP 503-normalised, NuGet lowercased, the rest as published."""
    if system is System.pypi:
        return _PEP503_RUN.sub("-", name).lower()
    if system is System.nuget:
        return name.lower()
    return name


def _package_path(system: System, name: str) -> str:
    return f"/v3/systems/{system.value}/packages/{quote(_name(system, name), safe='')}"


def _site_url(system: System, name: str, version: str | None = None) -> str:
    base = f"https://deps.dev/{system.value}/{quote(_name(system, name), safe='')}"
    return f"{base}/{quote(version, safe='')}" if version else base


class SourceLink(ToolOutput):
    label: str
    url: str


class VersionSummary(ToolOutput):
    version: str
    published_at: str | None = None
    deprecated: bool = False


class PackageInput(ToolInput):
    system: System = Field(description="Package ecosystem: npm, pypi, go, cargo, maven, nuget or rubygems.")
    name: str = Field(min_length=1, max_length=NAME_MAX_CHARS,
                      description="Package name as the ecosystem spells it: 'express', 'requests', "
                      "'github.com/gin-gonic/gin', 'org.slf4j:slf4j-api'.")


class PackageOutput(ToolOutput):
    system: System
    name: str
    url: str
    versions_count: int
    default_version: str | None = None  # what the registry installs by default (npm 'latest', newest stable)
    default_published_at: str | None = None
    first_published_at: str | None = None
    latest_published_at: str | None = None
    deprecated_versions: int = 0
    recent_versions: list[VersionSummary] = Field(default_factory=list)
    licenses: list[str] = Field(default_factory=list)  # of the default version (SPDX expressions)
    advisories: int | None = None  # OSV advisories affecting the default version
    advisory_keys: list[str] = Field(default_factory=list)
    links: list[SourceLink] = Field(default_factory=list)


def _links(doc: dict[str, Any]) -> list[SourceLink]:
    rows = doc.get("links") or []
    return [SourceLink(label=str(x.get("label", "")).lower(), url=x["url"]) for x in rows if x.get("url")]


async def _version_doc(ctx: RunContext, system: System, name: str, version: str) -> dict[str, Any]:
    return await ctx.get_json(DEPSDEV, f"{_package_path(system, name)}/versions/{quote(version, safe='')}")


@tool(
    provider=DEPSDEV,
    slug="package",
    name="deps.dev Package",
    summary="Any package's version history across npm, PyPI, Go, Cargo, Maven, NuGet, RubyGems, with its default "
    "version's licences and advisories.",
    description="One call per package in any of seven ecosystems: how many versions exist, which one is the "
    "default, when the first, newest and default versions were published, how many are deprecated, the five most "
    "recently published, and for the default version its SPDX licences, the OSV security advisories that affect "
    "it and its homepage/repository links. Data from Google's Open Source Insights (CC BY 4.0). For one specific "
    "version use depsdev/version; for npm download counts use npm/package.",
    categories=(Category.developer,),
    render=Render.package,
    price=LOCAL,
    example={"system": "npm", "name": "express"},
    see_also=("depsdev/version", "npm/package", "pypi/package", "github/repo"),
    cache_ttl_s=TTL_PAGE_S,
)
async def package(inp: PackageInput, ctx: RunContext) -> PackageOutput:
    try:
        data = await ctx.get_json(DEPSDEV, _package_path(inp.system, inp.name))
    except ToolNotFoundResult as nf:
        raise ToolNotFoundResult(f"deps.dev has no {inp.system.value} package called {inp.name}") from nf
    versions = data.get("versions") or []
    dated = sorted((v for v in versions if v.get("publishedAt")), key=lambda v: v["publishedAt"])
    default = next((v for v in versions if v.get("isDefault")), None)
    default_version = (default or {}).get("versionKey", {}).get("version")
    out = PackageOutput(
        system=inp.system,
        name=(data.get("packageKey") or {}).get("name") or inp.name,
        url=_site_url(inp.system, inp.name),
        versions_count=len(versions),
        default_version=default_version,
        default_published_at=(default or {}).get("publishedAt"),
        first_published_at=dated[0]["publishedAt"] if dated else None,
        latest_published_at=dated[-1]["publishedAt"] if dated else None,
        deprecated_versions=sum(1 for v in versions if v.get("isDeprecated")),
        recent_versions=[
            VersionSummary(version=v["versionKey"]["version"], published_at=v.get("publishedAt"),
                           deprecated=bool(v.get("isDeprecated")))
            for v in reversed(dated[-RECENT_VERSIONS:])
        ],
    )
    if default_version:
        try:
            doc = await _version_doc(ctx, inp.system, inp.name, default_version)
        except (ToolError, ToolNotFoundResult):
            ctx.note("deps.dev did not return the default version's details; licences and advisories are missing.")
            return out
        keys = [a["id"] for a in doc.get("advisoryKeys") or [] if a.get("id")]
        out.licenses = doc.get("licenses") or []
        out.advisories = len(keys)
        out.advisory_keys = keys[:MAX_ADVISORIES]
        out.links = _links(doc)
    return out


class VersionInput(PackageInput):
    version: str = Field(min_length=1, max_length=VERSION_MAX_CHARS, description="Exact version, e.g. '4.17.20'.")


class RelatedProject(ToolOutput):
    id: str  # e.g. github.com/expressjs/express
    relation: str | None = None  # SOURCE_REPO, ISSUE_TRACKER, …
    provenance: str | None = None  # how deps.dev knows (verified SLSA attestation or unverified metadata)


class VersionOutput(ToolOutput):
    system: System
    name: str
    version: str
    url: str
    published_at: str | None = None
    is_default: bool = False
    deprecated_reason: str | None = None
    licenses: list[str] = Field(default_factory=list)
    advisory_keys: list[str] = Field(default_factory=list)
    links: list[SourceLink] = Field(default_factory=list)
    related_projects: list[RelatedProject] = Field(default_factory=list)


@tool(
    provider=DEPSDEV,
    slug="version",
    name="deps.dev Package Version",
    summary="One package version's licences, security advisories (OSV ids), links and source repository.",
    description="For an exact version of an npm, PyPI, Go, Cargo, Maven, NuGet or RubyGems package: its SPDX "
    "licences, the OSV advisory ids that affect it (e.g. GHSA-…), whether it is the default or deprecated, when "
    "it was published, its links and the source projects deps.dev relates it to, with how that relation is known. "
    "Good for 'is lodash 4.17.20 vulnerable' and licence checks. It does not resolve dependency trees; for the "
    "package's version list use depsdev/package.",
    categories=(Category.developer,),
    render=Render.package,
    price=LOCAL,
    example={"system": "npm", "name": "lodash", "version": "4.17.20"},
    see_also=("depsdev/package", "npm/package", "pypi/package", "github/repo"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def version(inp: VersionInput, ctx: RunContext) -> VersionOutput:
    try:
        doc = await _version_doc(ctx, inp.system, inp.name, inp.version)
    except ToolNotFoundResult as nf:
        raise ToolNotFoundResult(f"deps.dev has no {inp.system.value} {inp.name} {inp.version}") from nf
    related = [
        RelatedProject(id=p["projectKey"]["id"], relation=p.get("relationType"), provenance=p.get("relationProvenance"))
        for p in doc.get("relatedProjects") or []
        if (p.get("projectKey") or {}).get("id")
    ]
    return VersionOutput(
        system=inp.system,
        name=inp.name,
        version=(doc.get("versionKey") or {}).get("version") or inp.version,
        url=_site_url(inp.system, inp.name, inp.version),
        published_at=doc.get("publishedAt"),
        is_default=bool(doc.get("isDefault")),
        deprecated_reason=doc.get("deprecatedReason") or None,
        licenses=doc.get("licenses") or [],
        advisory_keys=[a["id"] for a in doc.get("advisoryKeys") or [] if a.get("id")],
        links=_links(doc),
        related_projects=related[:MAX_RELATED],
    )
