"""Internet Archive Wayback Machine provider (archive.org/help/wayback_api.php)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

WAYBACK = Provider(
    id="wayback",
    display_name="Wayback Machine",
    summary="The Internet Archive's Wayback Machine: the archived capture of a URL closest to a date.",
    homepage="https://web.archive.org",
    docs_url="https://archive.org/help/wayback_api.php",
    base_url="https://archive.org",
    categories=(Category.web_extraction, Category.research),
    terms=Terms.allowed,
    auth=NoAuth(),
    max_concurrency=2,
    # The Wayback APIs allow 15 requests a minute per IP and answer 429 beyond that (Internet Archive, 2026).
    rate="15/minute",
    attribution="Internet Archive Wayback Machine",
)
