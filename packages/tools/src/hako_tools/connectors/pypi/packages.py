"""pypi/package: one project's latest (or a given) release from the PyPI JSON API, trimmed to what agents use."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.pypi.provider import PYPI
from hako_tools.constants import TTL_PAGE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

# PEP 508 names: letters, digits and . _ - (starting and ending with a letter or digit).
NAME_PATTERN = r"^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$"
NAME_MAX_CHARS = 100
VERSION_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._+!-]*$"  # PEP 440 public and local versions
VERSION_MAX_CHARS = 64
LICENSE_MAX_CHARS = 120  # longer `license` values are the whole licence text pasted in; use the classifier then
SUMMARY_CHARS = 500
MAX_VULNERABILITIES = 20
_LICENSE_CLASSIFIER = "License :: "
_EXTRA_MARKER = "extra =="


class PackageInput(ToolInput):
    name: str = Field(min_length=1, max_length=NAME_MAX_CHARS, pattern=NAME_PATTERN,
                      description="PyPI project name, e.g. 'httpx'.")
    version: str | None = Field(None, max_length=VERSION_MAX_CHARS, pattern=VERSION_PATTERN,
                                description="A specific release (default: the latest).")


class Vulnerability(ToolOutput):
    id: str
    aliases: list[str] = Field(default_factory=list)
    fixed_in: list[str] = Field(default_factory=list)
    link: str | None = None


class PackageOutput(ToolOutput):
    name: str
    version: str
    summary: str | None = None
    license: str | None = None
    requires_python: str | None = None
    dependencies: int = 0  # requirements outside optional extras
    project_urls: dict[str, str] = Field(default_factory=dict)
    pypi_url: str
    uploaded_at: str | None = None  # newest file upload of this release
    yanked: bool = False
    yanked_reason: str | None = None
    vulnerabilities: list[Vulnerability] = Field(default_factory=list)


def _licence(info: dict[str, Any]) -> str | None:
    if expression := info.get("license_expression"):
        return str(expression)
    text = info.get("license")
    if isinstance(text, str) and text.strip() and len(text) <= LICENSE_MAX_CHARS:
        return text.strip()
    names = [c.rsplit(" :: ", 1)[-1] for c in info.get("classifiers") or [] if c.startswith(_LICENSE_CLASSIFIER)]
    return " / ".join(names) or None


def _vulnerability(row: dict[str, Any]) -> Vulnerability:
    return Vulnerability(id=str(row.get("id", "")), aliases=row.get("aliases") or [],
                         fixed_in=row.get("fixed_in") or [], link=row.get("link"))


@tool(
    provider=PYPI,
    slug="package",
    name="PyPI Package",
    summary="A Python package's latest version, licence, supported Python, links, upload time, yanked flag and CVEs.",
    description="Reads PyPI's JSON API for a project (its latest release, or the version you name) and returns "
    "the version, summary, licence (SPDX expression when declared, else the licence classifier), requires-python, "
    "how many required dependencies it declares, its project links (source, docs, changelog), when the release "
    "was uploaded, whether it is yanked and why, and the known vulnerabilities PyPI lists for that release (OSV "
    "ids with the versions that fix them). It does not list every release or read the README: use "
    "depsdev/package for version history and github/repo for repository activity.",
    categories=(Category.developer,),
    render=Render.package,
    price=LOCAL,
    example={"name": "httpx"},
    see_also=("depsdev/package", "depsdev/version", "github/repo", "npm/package"),
    cache_ttl_s=TTL_PAGE_S,
)
async def package(inp: PackageInput, ctx: RunContext) -> PackageOutput:
    path = f"/pypi/{inp.name}/{inp.version}/json" if inp.version else f"/pypi/{inp.name}/json"
    try:
        data = await ctx.get_json(PYPI, path)
    except ToolNotFoundResult as nf:
        what = f"{inp.name} {inp.version}" if inp.version else inp.name
        raise ToolNotFoundResult(f"PyPI has no project or release called {what}") from nf
    info = data.get("info") or {}
    files = data.get("urls") or []
    uploads = [f["upload_time_iso_8601"] for f in files if f.get("upload_time_iso_8601")]
    requires = [r for r in info.get("requires_dist") or [] if _EXTRA_MARKER not in r]
    summary = info.get("summary")
    vulns = data.get("vulnerabilities") or []
    if len(vulns) > MAX_VULNERABILITIES:
        ctx.note(f"{len(vulns)} vulnerabilities are listed; the first {MAX_VULNERABILITIES} are shown.")
    return PackageOutput(
        name=info.get("name") or inp.name,
        version=info.get("version") or inp.version or "",
        summary=summary[:SUMMARY_CHARS] if isinstance(summary, str) and summary else None,
        license=_licence(info),
        requires_python=info.get("requires_python") or None,
        dependencies=len(requires),
        project_urls={str(k): str(v) for k, v in (info.get("project_urls") or {}).items()},
        pypi_url=info.get("release_url") or info.get("package_url") or f"https://pypi.org/project/{inp.name}/",
        uploaded_at=max(uploads) if uploads else None,
        yanked=bool(info.get("yanked")),
        yanked_reason=info.get("yanked_reason") or None,
        vulnerabilities=[_vulnerability(v) for v in vulns[:MAX_VULNERABILITIES] if isinstance(v, dict)],
    )
