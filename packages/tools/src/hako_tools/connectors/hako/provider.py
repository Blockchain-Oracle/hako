"""Hako as a provider: computation and indexes we run ourselves (no third-party terms apply)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

HAKO = Provider(
    id="hako",
    display_name="Hako",
    summary="Hako's own tools: cited answers from live sources, time zones and holidays, cross-checked FX and "
    "weather, a 72-hour news index and 89 company job boards.",
    homepage="https://usehako.site",
    base_url="https://usehako.site",
    categories=(Category.ai_answers, Category.time, Category.finance, Category.weather, Category.news, Category.jobs),
    terms=Terms.ours,
    auth=NoAuth(),
)
