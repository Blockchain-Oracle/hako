"""Google News RSS (news.google.com/rss, checked 2026-10-07): search and section feeds, no key, no published limit.

Topic feeds answer with a redirect to a per-edition topic id; the shared client follows it.
"""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

GOOGLE_NEWS = Provider(
    id="google-news",
    display_name="Google News",
    summary="Headlines from thousands of publishers, searchable by keyword and filterable by country, language and "
    "recency, plus top stories by topic.",
    homepage="https://news.google.com",
    docs_url="https://news.google.com/rss",
    base_url="https://news.google.com",
    categories=(Category.news,),
    terms=Terms.value_added,
    auth=NoAuth(),
    max_concurrency=2,
    rate="60/minute",
    attribution="Google News (headlines link to each publisher)",
    logo_domain="news.google.com",
)
