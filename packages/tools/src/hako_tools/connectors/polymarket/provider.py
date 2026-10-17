"""Polymarket Gamma API (docs.polymarket.com, checked 2026-10-17): keyless, read only.

Gotcha: `outcomes`, `outcomePrices` and `clobTokenIds` come back as JSON-encoded strings.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

POLYMARKET = Provider(
    id="polymarket",
    display_name="Polymarket",
    summary="Prediction markets on politics, crypto, sports and culture: outcomes, implied odds, volume and liquidity.",
    homepage="https://polymarket.com",
    docs_url="https://docs.polymarket.com/developers/gamma-markets-api/overview",
    base_url="https://gamma-api.polymarket.com",
    categories=(Category.finance, Category.crypto, Category.news),
    terms=Terms.value_added,
    auth=NoAuth(),
    max_concurrency=4,
)
