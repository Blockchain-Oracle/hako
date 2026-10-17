"""LI.FI providers (docs.li.fi, checked 2026-10-17).

- `lifi` (li.quest/v1): token facts by symbol or address. Works keyless at 100 requests a minute (the
  `ratelimit-limit` header, 2026-10-17); `LIFI_API_KEY` raises it when set.
- `lifi-earn` (earn.li.fi/v1): the Earn Data API (vaults, a wallet's positions). Every call needs the key (keyless
  answers 401 "Missing x-lifi-api-key header"), so its tools report unavailable until `LIFI_API_KEY` is set;
  50 requests a minute per key.
"""

from hako_tools.categories import Category
from hako_tools.framework import Header, Provider, Terms

LIFI_KEY_ENV = "LIFI_API_KEY"
LIFI_KEY_HEADER = "x-lifi-api-key"

LIFI = Provider(
    id="lifi",
    display_name="LI.FI",
    summary="Token facts across 60+ chains: address, decimals, logo, USD price and verification.",
    homepage="https://li.fi",
    docs_url="https://docs.li.fi/api-reference/fetch-information-about-a-token",
    base_url="https://li.quest/v1",
    categories=(Category.crypto,),
    terms=Terms.allowed,
    auth=Header(LIFI_KEY_HEADER, LIFI_KEY_ENV, optional=True),
    rate="100/minute",
    max_concurrency=4,
)

LIFI_EARN = Provider(
    id="lifi-earn",
    display_name="LI.FI Earn",
    summary="Where tokens earn: DeFi vaults across chains ranked by APY or TVL, and a wallet's open Earn positions.",
    homepage="https://li.fi",
    docs_url="https://docs.li.fi/earn/guides/api-integration",
    base_url="https://earn.li.fi/v1",
    categories=(Category.crypto, Category.finance),
    terms=Terms.allowed,
    auth=Header(LIFI_KEY_HEADER, LIFI_KEY_ENV),
    rate="50/minute",
    max_concurrency=4,
    logo_domain="li.fi",
)
