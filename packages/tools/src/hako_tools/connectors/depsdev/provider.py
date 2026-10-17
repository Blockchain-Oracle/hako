"""deps.dev API v3 provider (docs.deps.dev/api/v3; data CC BY 4.0, caching expressly permitted)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

DEPSDEV = Provider(
    id="depsdev",
    display_name="deps.dev",
    summary="Google's Open Source Insights: version history, licences, security advisories and source "
    "repositories for npm, PyPI, Go, Cargo, Maven, NuGet and RubyGems packages.",
    homepage="https://deps.dev",
    docs_url="https://docs.deps.dev/api/v3/",
    base_url="https://api.deps.dev",
    categories=(Category.developer,),
    terms=Terms.open,
    auth=NoAuth(),
    max_concurrency=4,
    licence="CC BY 4.0",
    attribution="deps.dev (Open Source Insights, Google)",
)
