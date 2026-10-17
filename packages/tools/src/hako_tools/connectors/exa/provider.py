"""Exa API (docs.exa.ai/reference, checked 2026-10-17): `x-api-key` header. Search with highlights costs about
$0.005 + $0.001 per page and an answer about $0.005, so both endpoints are PREMIUM."""

from hako_tools.categories import Category
from hako_tools.framework import Header, Provider, Terms

EXA = Provider(
    id="exa",
    display_name="Exa",
    summary="Search built for AI: meaning-based web search with the best passages of each page, and cited answers.",
    homepage="https://exa.ai",
    docs_url="https://docs.exa.ai/reference/search",
    base_url="https://api.exa.ai",
    categories=(Category.web_search, Category.ai_answers),
    terms=Terms.allowed,
    auth=Header("x-api-key", "EXA_API_KEY"),
    max_concurrency=4,
)
