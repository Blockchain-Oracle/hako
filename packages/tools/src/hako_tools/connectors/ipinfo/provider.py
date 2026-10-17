"""IPinfo provider definition (Lite API: free, no request cap, country + ASN; ipinfo.io/developers/lite-api,
2026-10-07). The token goes in a Bearer header so it never appears in a URL."""

from hako_tools.categories import Category
from hako_tools.framework import Bearer, Provider, Terms

IPINFO = Provider(
    id="ipinfo",
    display_name="IPinfo",
    summary="Country, continent and network owner (ASN, AS name and domain) for any public IPv4 or IPv6 address.",
    homepage="https://ipinfo.io",
    docs_url="https://ipinfo.io/developers/lite-api",
    base_url="https://api.ipinfo.io",
    categories=(Category.network,),
    terms=Terms.open,
    auth=Bearer("IPINFO_TOKEN"),
    max_concurrency=4,
    licence="CC BY-SA 4.0",
    attribution="IPinfo",
)
