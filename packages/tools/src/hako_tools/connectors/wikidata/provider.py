"""Wikidata provider (MediaWiki Action API with the Wikibase modules; wikidata.org/wiki/Wikidata:Data_access)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

WIKIDATA = Provider(
    id="wikidata",
    display_name="Wikidata",
    summary="The structured knowledge base behind Wikipedia: entity search and key facts for any person, place, "
    "organisation or thing.",
    homepage="https://www.wikidata.org",
    docs_url="https://www.wikidata.org/wiki/Wikidata:Data_access",
    base_url="https://www.wikidata.org",
    categories=(Category.knowledge,),
    terms=Terms.open,
    auth=NoAuth(),
    # Shares Wikimedia's 200 requests/minute, ≤ 3 concurrent budget with Wikipedia (see wikipedia/provider.py).
    rate="80/minute",
    max_concurrency=1,
    licence="CC0 1.0",
    attribution="Wikidata (wikidata.org)",
)
