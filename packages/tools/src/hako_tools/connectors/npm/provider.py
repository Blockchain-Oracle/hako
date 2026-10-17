"""npm registry providers: package documents (registry.npmjs.org) and download counts (api.npmjs.org).

The download-count API lives on its own host, so it is a second provider used only inside npm/package (it has
no public endpoints of its own and therefore never appears in the catalog).
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

NPM = Provider(
    id="npm",
    display_name="npm",
    summary="JavaScript package metadata from the public npm registry: latest version, licence, repository, "
    "deprecation and weekly downloads.",
    homepage="https://www.npmjs.com",
    docs_url="https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md",
    base_url="https://registry.npmjs.org",
    categories=(Category.developer,),
    terms=Terms.allowed,
    auth=NoAuth(),
    max_concurrency=4,
    attribution="npm registry",
)

NPM_DOWNLOADS = Provider(
    id="npm-downloads",
    display_name="npm download counts",
    summary="Download counts for npm packages.",
    homepage="https://www.npmjs.com",
    docs_url="https://github.com/npm/registry/blob/main/docs/download-counts.md",
    base_url="https://api.npmjs.org",
    categories=(Category.developer,),
    terms=Terms.allowed,
    auth=NoAuth(),
    max_concurrency=4,
    attribution="npm download counts",
)
