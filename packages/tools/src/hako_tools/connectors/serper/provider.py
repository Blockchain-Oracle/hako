"""Serper provider definition (google.serper.dev; 1 credit per query of ≤ 10 results, serper.dev 2026-10-07)."""

from hako_tools.categories import Category
from hako_tools.framework import Header, Provider, Terms

SERPER = Provider(
    id="serper",
    display_name="Serper",
    summary="Google results as JSON: web (with answer box and knowledge panel), news, Google Scholar, local "
    "places and images.",
    homepage="https://serper.dev",
    docs_url="https://serper.dev/playground",
    base_url="https://google.serper.dev",
    categories=(Category.web_search, Category.news, Category.research, Category.places),
    terms=Terms.value_added,
    auth=Header("X-API-KEY", "SERPER_API_KEY"),
    # serper.dev publishes 50 queries/second for its smallest paid pack and nothing for the free credits; stay
    # well under that until we buy a pack.
    rate="5/second",
    max_concurrency=4,
)
