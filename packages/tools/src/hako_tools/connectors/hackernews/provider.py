"""Hacker News Search (Algolia) provider (hn.algolia.com/api)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

HACKERNEWS = Provider(
    id="hackernews",
    display_name="Hacker News",
    summary="Full-text search over every Hacker News story and comment, by relevance or by date, via Algolia.",
    homepage="https://news.ycombinator.com",
    docs_url="https://hn.algolia.com/api",
    base_url="https://hn.algolia.com",
    categories=(Category.news, Category.developer),
    terms=Terms.allowed,
    auth=NoAuth(),
    max_concurrency=4,
    rate="10000/hour",  # hn.algolia.com/api: "limiting the number of API requests from a single IP to 10,000/hour"
    attribution="Hacker News via Algolia",
    logo_domain="news.ycombinator.com",
)
