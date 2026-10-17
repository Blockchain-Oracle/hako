"""Open Food Facts providers (openfoodfacts.github.io/openfoodfacts-server/api/).

Product reads and searches have separate published limits (15 and 10 requests/minute per IP), and full-text
search lives on its own host (Search-a-licious), so each gets its own provider and rate limiter.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

LICENCE = "ODbL 1.0 (database), DbCL (contents), CC BY-SA (images)"
ATTRIBUTION = "Open Food Facts contributors (openfoodfacts.org)"

OPENFOODFACTS = Provider(
    id="openfoodfacts",
    display_name="Open Food Facts",
    summary="The open database of 4M+ packaged food products: ingredients, allergens, Nutri-Score, NOVA, nutrition.",
    homepage="https://world.openfoodfacts.org",
    docs_url="https://openfoodfacts.github.io/openfoodfacts-server/api/",
    base_url="https://world.openfoodfacts.org",
    categories=(Category.science,),
    terms=Terms.open,
    auth=NoAuth(),  # reads need only a descriptive User-Agent with contact, which the shared client sends
    rate="15/minute",  # "15 req/min/IP address for all read product queries"
    licence=LICENCE,
    attribution=ATTRIBUTION,
)

OPENFOODFACTS_SEARCH = Provider(
    id="openfoodfacts-search",
    display_name="Open Food Facts Search",
    summary="Search-a-licious, Open Food Facts' full-text product search.",
    homepage="https://search.openfoodfacts.org",
    docs_url="https://search.openfoodfacts.org/docs",
    base_url="https://search.openfoodfacts.org",
    categories=(Category.science,),
    terms=Terms.open,
    auth=NoAuth(),
    rate="10/minute",  # "10 req/min/IP address for all search queries"
    licence=LICENCE,
    attribution=ATTRIBUTION,
    logo_domain="openfoodfacts.org",
)
