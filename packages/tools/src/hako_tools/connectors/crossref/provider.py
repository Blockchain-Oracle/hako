"""Crossref provider (REST API; crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

CROSSREF = Provider(
    id="crossref",
    display_name="Crossref",
    summary="Publisher-deposited metadata for 170M+ DOIs: titles, authors, journals, dates, citation counts, "
    "corrections and retractions.",
    homepage="https://www.crossref.org",
    docs_url="https://api.crossref.org/swagger-ui/index.html",
    base_url="https://api.crossref.org",
    categories=(Category.research,),
    terms=Terms.open,
    auth=NoAuth(),  # the shared User-Agent carries a mailto, which puts every call in the polite pool
    # Polite pool (response headers, 2026-10-07): single-DOI lookups 10/s, list queries 3/s, 3 concurrent. One
    # limiter covers both, so it takes the stricter list figure.
    rate="3/second",
    max_concurrency=3,
    licence="Metadata facts; mostly CC0 (abstracts remain the publisher's)",
    attribution="Crossref (crossref.org)",
)
