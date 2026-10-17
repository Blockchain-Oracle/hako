"""CoinGecko public API v3 (docs.coingecko.com, checked 2026-10-07).

Keyless calls share a public pool of roughly 5-15 calls per minute per IP, so the client is held to 10/minute and
every answer is cached (prices for a minute); a demo key would raise it to 30/minute.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

COINGECKO = Provider(
    id="coingecko",
    display_name="CoinGecko",
    summary="Crypto market data for 17,000+ coins: prices, 24h and 7d change, market cap, volume, all-time highs and "
    "what is trending.",
    homepage="https://www.coingecko.com",
    docs_url="https://docs.coingecko.com/v3.0.1/reference/introduction",
    base_url="https://api.coingecko.com/api/v3",
    categories=(Category.crypto, Category.finance),
    terms=Terms.value_added,
    auth=NoAuth(),
    max_concurrency=2,
    rate="10/minute",
    attribution="Data provided by CoinGecko",
)
