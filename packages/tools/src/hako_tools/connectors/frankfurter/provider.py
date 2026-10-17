"""Frankfurter API v2 provider (frankfurter.dev/docs; v1 is deprecated)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

FRANKFURTER = Provider(
    id="frankfurter",
    display_name="Frankfurter",
    summary="Exchange rates published by 100+ central banks (the ECB and others): latest, by date, converted, "
    "and as a short daily history.",
    homepage="https://frankfurter.dev",
    docs_url="https://frankfurter.dev/docs/",
    base_url="https://api.frankfurter.dev",
    categories=(Category.finance,),
    terms=Terms.open,  # free, commercial use allowed; the rates stay under each central bank's own terms
    auth=NoAuth(),
    max_concurrency=4,
    licence="central-bank reference data",
    attribution="Frankfurter (rates published by the ECB and other central banks)",
)
