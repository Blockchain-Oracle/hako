"""PyPI JSON API provider (docs.pypi.org/api/json)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

PYPI = Provider(
    id="pypi",
    display_name="PyPI",
    summary="Python package metadata from the Python Package Index: latest version, licence, supported Python, "
    "project links, upload time, yanked releases and known vulnerabilities.",
    homepage="https://pypi.org",
    docs_url="https://docs.pypi.org/api/json/",
    base_url="https://pypi.org",
    categories=(Category.developer,),
    terms=Terms.allowed,
    auth=NoAuth(),
    max_concurrency=4,
    attribution="Python Package Index (PyPI)",
)
