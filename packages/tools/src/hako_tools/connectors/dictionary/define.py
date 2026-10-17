"""dictionary/define: one English word's entries, merged and trimmed to what an agent reads."""

from typing import Any
from urllib.parse import quote

from pydantic import Field

from hako_tools.connectors.dictionary.provider import DICTIONARY
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

WORD_PATTERN = r"^[A-Za-z][A-Za-z' -]*$"
WORD_MAX_CHARS = 60
MEANINGS_MAX = 6
DEFINITIONS_PER_MEANING = 4
RELATED_MAX = 8  # synonyms / antonyms kept per meaning


class Definition(ToolOutput):
    definition: str
    example: str | None = None


class Meaning(ToolOutput):
    part_of_speech: str
    definitions: list[Definition]
    synonyms: list[str] = Field(default_factory=list)
    antonyms: list[str] = Field(default_factory=list)


class DefineInput(ToolInput):
    word: str = Field(min_length=1, max_length=WORD_MAX_CHARS, pattern=WORD_PATTERN,
                      description="An English word or short phrase, e.g. 'serendipity'.")


class DefineOutput(ToolOutput):
    word: str
    phonetic: str | None = None
    audio: str | None = None
    origin: str | None = None
    meanings: list[Meaning]
    source_url: str | None = None


def _related(raw: dict[str, Any], key: str) -> list[str]:
    """A meaning's own synonyms (or antonyms) plus its definitions', deduplicated in order."""
    words: list[str] = [*(raw.get(key) or []), *(w for d in raw.get("definitions") or [] for w in d.get(key) or [])]
    return list(dict.fromkeys(str(w) for w in words))


def _meaning(raw: dict[str, Any]) -> Meaning:
    definitions = [
        Definition(definition=d.get("definition", ""), example=d.get("example"))
        for d in (raw.get("definitions") or [])[:DEFINITIONS_PER_MEANING]
    ]
    synonyms, antonyms = _related(raw, "synonyms"), _related(raw, "antonyms")
    return Meaning(part_of_speech=raw.get("partOfSpeech", ""), definitions=definitions,
                   synonyms=synonyms[:RELATED_MAX], antonyms=antonyms[:RELATED_MAX])


@tool(
    provider=DICTIONARY,
    slug="define",
    name="Dictionary Definition",
    summary="Define an English word: pronunciation (IPA + audio), meanings by part of speech, examples, synonyms.",
    description="Looks up one English word in the Free Dictionary API (Wiktionary data) and returns its phonetic "
    "spelling, a pronunciation audio URL, and up to six meanings grouped by part of speech, each with definitions, "
    "example sentences, synonyms and antonyms. English only; an unknown word answers found=false. For 'what's the "
    "word for…', rhymes or sound-alikes use datamuse/words; for encyclopaedic topics use wikipedia/summary.",
    categories=(Category.language,),
    render=Render.definition,
    price=LOCAL,
    example={"word": "serendipity"},
    see_also=("datamuse/words", "wikipedia/summary"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def define(inp: DefineInput, ctx: RunContext) -> DefineOutput:
    entries = await ctx.get_json(DICTIONARY, f"/api/v2/entries/en/{quote(inp.word.lower(), safe='')}")
    if not isinstance(entries, list) or not entries:
        raise ToolNotFoundResult(f"No dictionary entry for {inp.word!r}")
    first: dict[str, Any] = entries[0]
    phonetics = [p for e in entries for p in e.get("phonetics") or []]
    audio = next((p["audio"] for p in phonetics if p.get("audio")), None)
    phonetic = first.get("phonetic") or next((p["text"] for p in phonetics if p.get("text")), None)
    meanings = [_meaning(m) for e in entries for m in e.get("meanings") or []][:MEANINGS_MAX]
    return DefineOutput(
        word=first.get("word") or inp.word,
        phonetic=phonetic,
        audio=audio,
        origin=next((e["origin"] for e in entries if e.get("origin")), None),
        meanings=meanings,
        source_url=next((u for e in entries for u in e.get("sourceUrls") or []), None),
    )
