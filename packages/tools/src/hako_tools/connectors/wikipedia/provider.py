"""Wikipedia provider (Wikimedia REST APIs on <lang>.wikipedia.org; mediawiki.org/wiki/API:REST_API)."""

from typing import Any

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, RunContext, Terms

DEFAULT_LANG = "en"
# A language edition is a subdomain (fr.wikipedia.org); the pattern keeps the host a Wikipedia one.
LANG_PATTERN = r"^[a-z]{2,3}(-[a-z]{2,8})?$"

WIKIPEDIA = Provider(
    id="wikipedia",
    display_name="Wikipedia",
    summary="Article summaries, title search and 'on this day' events from Wikipedia in any language.",
    homepage="https://www.wikipedia.org",
    docs_url="https://www.mediawiki.org/wiki/API:REST_API",
    base_url=f"https://{DEFAULT_LANG}.wikipedia.org",
    categories=(Category.knowledge,),
    terms=Terms.open,
    auth=NoAuth(),
    # Wikimedia allows a bot with a descriptive User-Agent 200 requests/minute across *all* Wikimedia sites and
    # ≤ 3 concurrent requests (mediawiki.org/wiki/Wikimedia_APIs/Rate_limits). Wikipedia and Wikidata share
    # that budget here: 120 + 80 per minute, 2 + 1 connections.
    rate="120/minute",
    max_concurrency=2,
    licence="CC BY-SA 4.0",
    attribution="Wikipedia contributors (wikipedia.org)",
)


async def wiki_get(ctx: RunContext, lang: str, path: str, params: dict[str, Any] | None = None) -> Any:
    """GET JSON from one language edition. Other editions are other hosts, so they go as an absolute URL; the
    recorded source is then corrected to that host (RunContext prefixes the provider's base URL)."""
    if lang == DEFAULT_LANG:
        return await ctx.get_json(WIKIPEDIA, path, params=params)
    url = f"https://{lang}.wikipedia.org{path}"
    data = await ctx.get_json(WIKIPEDIA, url, params=params)
    if ctx.sources:
        ctx.sources[-1].url = url
    return data
