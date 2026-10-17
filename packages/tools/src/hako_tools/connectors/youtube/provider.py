"""YouTube oEmbed provider (oembed.com; YouTube's public, keyless embed-metadata endpoint)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

YOUTUBE = Provider(
    id="youtube",
    display_name="YouTube",
    summary="Public YouTube video metadata (title, channel, thumbnail) through oEmbed; no transcripts.",
    homepage="https://www.youtube.com",
    docs_url="https://oembed.com",
    base_url="https://www.youtube.com",
    categories=(Category.web_extraction,),
    terms=Terms.allowed,
    auth=NoAuth(),
    max_concurrency=4,
    attribution="YouTube",
)
