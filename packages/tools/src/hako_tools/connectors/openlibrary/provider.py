"""Open Library provider (openlibrary.org/developers/api)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

OPENLIBRARY = Provider(
    id="openlibrary",
    display_name="Open Library",
    summary="The Internet Archive's open catalogue of books: works, authors, editions, ISBNs and covers.",
    homepage="https://openlibrary.org",
    docs_url="https://openlibrary.org/developers/api",
    base_url="https://openlibrary.org",
    categories=(Category.knowledge,),
    terms=Terms.open,
    auth=NoAuth(),
    # 1 request/s anonymous, 3/s when the User-Agent names the app and a contact email (ours does).
    rate="3/second",
    licence="Open data (the Internet Archive asserts no new rights over the catalogue)",
    attribution="Open Library, Internet Archive (openlibrary.org)",
)
