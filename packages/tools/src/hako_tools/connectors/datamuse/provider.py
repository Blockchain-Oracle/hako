"""Datamuse provider (datamuse.com/api)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

DATAMUSE = Provider(
    id="datamuse",
    display_name="Datamuse",
    summary="A word-finding engine: words that mean, sound or are spelled like a clue, rhymes, synonyms and "
    "associations.",
    homepage="https://www.datamuse.com",
    docs_url="https://www.datamuse.com/api/",
    base_url="https://api.datamuse.com",
    categories=(Category.language,),
    terms=Terms.open,
    # Free without a key, 100,000 requests/day (a key becomes required from 1 February 2027; datamuse.com/api).
    auth=NoAuth(),
    rate="100000/day",
    licence="Free API; definitions from Wiktionary/WordNet",
    attribution="Datamuse API (datamuse.com)",
)
