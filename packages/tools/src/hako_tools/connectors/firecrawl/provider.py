"""Firecrawl provider definition (v2 API; credits per firecrawl.dev/pricing and docs.firecrawl.dev/billing)."""

from hako_tools.categories import Category
from hako_tools.framework import Bearer, Provider, Terms

FIRECRAWL = Provider(
    id="firecrawl",
    display_name="Firecrawl",
    summary="Live web search, any URL as clean markdown, site maps, and curated research, developer and "
    "government indexes.",
    homepage="https://www.firecrawl.dev",
    docs_url="https://docs.firecrawl.dev",
    base_url="https://api.firecrawl.dev",
    categories=(Category.web_search, Category.web_extraction, Category.research, Category.developer,
                Category.government),
    terms=Terms.consent_pending,
    auth=Bearer("FIRECRAWL_API_KEY"),
    max_concurrency=2,  # free plan: 2 concurrent browsers
    rate="10/minute",  # free plan scrape limit
)
