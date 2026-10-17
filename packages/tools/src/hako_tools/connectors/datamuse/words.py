"""Datamuse /words: one relation (means like, rhymes, …) against one clue, ranked by Datamuse's score."""

from enum import StrEnum
from typing import Any

from pydantic import Field

from hako_tools.connectors.datamuse.provider import DATAMUSE
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool

MAX_DEFAULT = 10
MAX_RESULTS = 20
DEFINITION_CHARS = 200
_POS = {"n": "noun", "v": "verb", "adj": "adjective", "adv": "adverb"}


class Relation(StrEnum):
    means_like = "means_like"  # reverse dictionary: a description or a word
    sounds_like = "sounds_like"
    spelled_like = "spelled_like"  # accepts wildcards: * any letters, ? one letter
    rhymes = "rhymes"
    near_rhymes = "near_rhymes"
    synonyms = "synonyms"
    antonyms = "antonyms"
    triggers = "triggers"  # words strongly associated with the clue in text
    adjectives_for = "adjectives_for"  # adjectives often used with a noun ("ocean" → "deep")
    nouns_for = "nouns_for"  # nouns often described by an adjective ("yellow" → "flowers")


_PARAM = {
    Relation.means_like: "ml",
    Relation.sounds_like: "sl",
    Relation.spelled_like: "sp",
    Relation.rhymes: "rel_rhy",
    Relation.near_rhymes: "rel_nry",
    Relation.synonyms: "rel_syn",
    Relation.antonyms: "rel_ant",
    Relation.triggers: "rel_trg",
    Relation.adjectives_for: "rel_jjb",
    Relation.nouns_for: "rel_jja",
}


class WordsInput(ToolInput):
    clue: str = Field(min_length=1, max_length=200,
                      description="A word or short description ('ringing in the ears'); wildcards for spelled_like.")
    relation: Relation = Field(Relation.means_like, description="How results relate to the clue.")
    topic: str | None = Field(None, max_length=100, description="Optional theme words that skew the ranking.")
    max: int = Field(MAX_DEFAULT, ge=1, le=MAX_RESULTS)
    definitions: bool = Field(False, description="Include a short definition per word.")


class WordRow(ToolOutput):
    word: str
    score: int | None = None
    parts_of_speech: str | None = None
    syllables: int | None = None
    definition: str | None = None


class WordsOutput(ToolOutput):
    clue: str
    relation: Relation
    rows: list[WordRow]


def _row(item: dict[str, Any]) -> WordRow:
    tags = [_POS[t] for t in item.get("tags") or [] if t in _POS]
    defs = item.get("defs") or []
    definition = defs[0].split("\t", 1)[-1].strip()[:DEFINITION_CHARS] if defs else None
    return WordRow(word=item.get("word", ""), score=item.get("score"), parts_of_speech=", ".join(tags) or None,
                   syllables=item.get("numSyllables"), definition=definition)


@tool(
    provider=DATAMUSE,
    slug="words",
    name="Datamuse Word Finder",
    summary="Find words: means-like (reverse dictionary), sounds-like, spelled-like, rhymes, synonyms, associations.",
    description="Answers 'what's the word for…' and wordplay queries in English: words meaning a description, "
    "rhymes and near rhymes, sound-alikes, spelling patterns with wildcards (e.g. 't??k*'), synonyms, antonyms, "
    "strongly associated words, or adjectives that go with a noun. Each word comes with parts of speech, syllable "
    "count and, on request, a short definition. It is not a dictionary: for full definitions, pronunciation and "
    "examples use dictionary/define.",
    categories=(Category.language,),
    render=Render.table,
    price=LOCAL,
    example={"clue": "ringing in the ears", "relation": "means_like", "max": 5, "definitions": True},
    see_also=("dictionary/define",),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def words(inp: WordsInput, ctx: RunContext) -> WordsOutput:
    params: dict[str, Any] = {_PARAM[inp.relation]: inp.clue, "max": inp.max, "md": "dps" if inp.definitions else "ps"}
    if inp.topic:
        params["topics"] = inp.topic
    data = await ctx.get_json(DATAMUSE, "/words", params=params)
    return WordsOutput(clue=inp.clue, relation=inp.relation, rows=[_row(i) for i in data or []])
