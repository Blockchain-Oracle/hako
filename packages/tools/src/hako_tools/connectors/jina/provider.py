"""Jina provider definitions. Reader and Search live on two hosts with separate rate limits (jina.ai/reader,
free API key: Reader 500 RPM, Search 100 RPM, 2026-10-07), so Search gets its own transport-only provider: every
endpoint registers under JINA (`jina/<slug>`), and `jina/search` sends its request through JINA_SEARCH."""

from hako_tools.categories import Category
from hako_tools.framework import Bearer, Provider, Terms

_SUMMARY = "Any URL as clean, LLM-ready markdown (Reader), and web search that returns each result's page text."

JINA = Provider(
    id="jina",
    display_name="Jina",
    summary=_SUMMARY,
    homepage="https://jina.ai/reader",
    docs_url="https://r.jina.ai/docs",
    base_url="https://r.jina.ai",
    categories=(Category.web_extraction, Category.web_search),
    terms=Terms.value_added,
    auth=Bearer("JINA_API_KEY"),
    rate="500/minute",
    max_concurrency=4,
)

JINA_SEARCH = Provider(
    id="jina-search",
    display_name="Jina Search",
    summary=_SUMMARY,
    homepage="https://jina.ai/reader",
    docs_url="https://s.jina.ai/docs",
    base_url="https://s.jina.ai",
    categories=(Category.web_search,),
    terms=Terms.value_added,
    auth=Bearer("JINA_API_KEY"),
    rate="100/minute",
    max_concurrency=2,
)
