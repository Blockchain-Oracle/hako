"""Free Dictionary API provider (dictionaryapi.dev; data drawn from Wiktionary)."""

from hako_tools.categories import Category
from hako_tools.framework import NoAuth, Provider, Terms

DICTIONARY = Provider(
    id="dictionary",
    display_name="Free Dictionary API",
    summary="English dictionary entries: phonetics with audio, meanings by part of speech, examples and synonyms.",
    homepage="https://dictionaryapi.dev",
    docs_url="https://dictionaryapi.dev",
    base_url="https://api.dictionaryapi.dev",
    categories=(Category.language,),
    terms=Terms.open,
    auth=NoAuth(),  # free and keyless; no published rate limit
    licence="CC BY-SA 3.0 (Wiktionary content)",  # each entry's own `license` field says so
    attribution="Free Dictionary API (dictionaryapi.dev), from Wiktionary contributors",
)
