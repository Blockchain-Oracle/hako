"""OpenAlex provider (REST API; help.openalex.org/how-to-use-the-api/rate-limits-and-authentication)."""

from hako_tools.categories import Category
from hako_tools.framework import Bearer, Provider, Terms

OPENALEX = Provider(
    id="openalex",
    display_name="OpenAlex",
    summary="Open index of 250M+ scholarly works and their authors, venues, citation counts and open-access links.",
    homepage="https://openalex.org",
    docs_url="https://docs.openalex.org",
    base_url="https://api.openalex.org",
    categories=(Category.research,),
    terms=Terms.open,
    # Keyless works within a small daily budget (2026-10-07 headers: $0.10/day; a search costs $0.001, a lookup by
    # id is free). A free key gives 10× that; it is sent as a Bearer token only when configured.
    auth=Bearer("HAKO_OPENALEX_API_KEY", optional=True),
    rate="100/second",  # more than 100 requests per second answers 429 (OpenAlex rate-limit docs)
    licence="CC0 1.0",
    attribution="OpenAlex (openalex.org)",
)
