"""OpenStreetMap's Nominatim geocoder (nominatim.org/release-docs/latest/api, checked 2026-10-07).

The public instance's usage policy: at most 1 request per second, an identifying User-Agent (ours names the app
and a contact) and no bulk geocoding. Every answer is cached for a day, so repeat lookups never reach it.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

OPENSTREETMAP = Provider(
    id="openstreetmap",
    display_name="OpenStreetMap",
    summary="Nominatim geocoding over OpenStreetMap: find any address, landmark or business and its coordinates, "
    "or turn coordinates back into a street address.",
    homepage="https://www.openstreetmap.org",
    docs_url="https://nominatim.org/release-docs/latest/api/Overview/",
    base_url="https://nominatim.openstreetmap.org",
    categories=(Category.places,),
    terms=Terms.open,
    auth=NoAuth(),
    max_concurrency=1,
    rate="1/second",
    licence="ODbL 1.0",
    attribution="© OpenStreetMap contributors (ODbL), geocoding by Nominatim",
    logo_domain="openstreetmap.org",
)
