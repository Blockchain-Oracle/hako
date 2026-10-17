"""Artificial Analysis data API v2 (artificialanalysis.ai/documentation, checked 2026-10-17): `x-api-key` header,
1,000 requests a day on the free tier (answers are cached an hour), attribution required."""

from hako_tools.categories import Category
from hako_tools.framework import Header, Provider, Terms

ARTIFICIAL_ANALYSIS = Provider(
    id="artificial-analysis",
    display_name="Artificial Analysis",
    summary="Independent AI model benchmarks: LLM intelligence, speed and price, and arena rankings for image, "
    "speech and video models.",
    homepage="https://artificialanalysis.ai",
    docs_url="https://artificialanalysis.ai/documentation",
    base_url="https://artificialanalysis.ai/api/v2",
    categories=(Category.developer, Category.research),
    terms=Terms.allowed,
    auth=Header("x-api-key", "ARTIFICIAL_ANALYSIS_API_KEY"),
    rate="1000/day",
    max_concurrency=2,
    attribution="Data from Artificial Analysis (artificialanalysis.ai)",
)
