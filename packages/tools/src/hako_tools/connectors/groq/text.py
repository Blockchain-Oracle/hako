"""Groq text rewriting: summarize and translate."""

from pydantic import Field

from hako_tools.connectors.groq.chat import UNTRUSTED_TEXT_RULE, Model, complete_json, strict_object
from hako_tools.connectors.groq.provider import GROQ
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import STANDARD, Category, Render, RunContext, ToolInput, ToolOutput, tool

# Free-plan Groq allows 8k tokens per minute per model; 20k characters is ≈ 5k tokens, leaving room for the
# prompt and the answer inside one minute's budget.
SUMMARIZE_MAX_CHARS = 20_000
SUMMARIZE_MIN_CHARS = 40
SUMMARIZE_MAX_TOKENS = 1_200  # reasoning (~150) + a summary of ≤ 150 words + up to 10 points
POINTS_DEFAULT = 5
POINTS_MAX = 10
FOCUS_MAX_CHARS = 300
TRANSLATE_MAX_CHARS = 5_000  # the translation is about as long as the source and must come back in < 8 s
TRANSLATE_MAX_TOKENS = 4_000  # 5k chars ≈ 1.3k English tokens; scripts such as Thai or Amharic take 2–3× more
LANGUAGE_MIN_CHARS = 2
LANGUAGE_MAX_CHARS = 40


class SummarizeInput(ToolInput):
    text: str = Field(min_length=SUMMARIZE_MIN_CHARS, max_length=SUMMARIZE_MAX_CHARS,
                      description="The text to summarise (an article, transcript, report, thread).")
    max_points: int = Field(POINTS_DEFAULT, ge=1, le=POINTS_MAX, description="How many key points at most.")
    focus: str | None = Field(None, max_length=FOCUS_MAX_CHARS,
                              description="What the reader cares about, e.g. 'pricing changes' or 'risks'.")


class SummarizeOutput(ToolOutput):
    answer: str = Field(description="The summary, a short paragraph.")
    key_points: list[str]
    source_chars: int


_SUMMARY_SCHEMA = strict_object({
    "summary": {"type": "string", "description": "One paragraph, at most 120 words."},
    "key_points": {"type": "array", "items": {"type": "string"}, "description": "Short, factual, one line each."},
})


@tool(
    provider=GROQ,
    slug="summarize",
    name="Groq Summarize",
    summary="Summarise up to 20k characters of text into a short paragraph plus key points, in about a second.",
    description="Condenses text you already have into a paragraph (≤ 120 words) and up to 10 one-line key "
    "points, using only what the text says; set focus to steer it. It does not fetch URLs: read a page first "
    "with jina/read. It does not answer questions from the web: use hako/answer. Text over 20,000 characters "
    "is rejected, so split long documents.",
    categories=(Category.text_ai,),
    render=Render.answer,
    price=STANDARD,
    example={
        "text": "The transistor was invented at Bell Labs in 1947 by John Bardeen and Walter Brattain, working "
        "under William Shockley. Their point-contact device used a germanium crystal to amplify a signal, "
        "replacing bulky and power-hungry vacuum tubes. Shockley followed with the more robust junction "
        "transistor in 1948. The three shared the 1956 Nobel Prize in Physics. Transistors made portable "
        "radios, computers and eventually integrated circuits possible; a modern phone chip holds billions.",
        "max_points": 3,
    },
    see_also=("jina/read", "groq/extract", "hako/answer"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def summarize(inp: SummarizeInput, ctx: RunContext) -> SummarizeOutput:
    focus = f" Emphasise what matters for: {inp.focus}." if inp.focus else ""
    system = (
        f"{UNTRUSTED_TEXT_RULE}\nSummarise the text faithfully: use only facts it states, keep numbers, names "
        f"and dates exact, and do not add opinions or outside knowledge. Write the summary in the text's own "
        f"language. Give at most {inp.max_points} key points.{focus}"
    )
    out = await complete_json(ctx, model=Model.fast, system=system, user=f"<text>\n{inp.text}\n</text>",
                              max_tokens=SUMMARIZE_MAX_TOKENS, schema=_SUMMARY_SCHEMA)
    points = [str(p).strip() for p in out.get("key_points") or [] if str(p).strip()]
    return SummarizeOutput(answer=str(out.get("summary") or "").strip(), key_points=points[: inp.max_points],
                           source_chars=len(inp.text))


class TranslateInput(ToolInput):
    text: str = Field(min_length=1, max_length=TRANSLATE_MAX_CHARS, description="The text to translate.")
    target_language: str = Field(min_length=LANGUAGE_MIN_CHARS, max_length=LANGUAGE_MAX_CHARS,
                                 description="Language to translate into, by name or code: 'French', 'pt-BR', "
                                 "'Yoruba'.")
    source_language: str | None = Field(None, min_length=LANGUAGE_MIN_CHARS, max_length=LANGUAGE_MAX_CHARS,
                                        description="The text's language if known; detected otherwise.")


class TranslateOutput(ToolOutput):
    translation: str
    source_language: str
    target_language: str


_TRANSLATE_SCHEMA = strict_object({
    "translation": {"type": "string"},
    "source_language": {"type": "string", "description": "English name of the source text's language."},
})


@tool(
    provider=GROQ,
    slug="translate",
    name="Groq Translate",
    summary="Translate up to 5,000 characters into any language, keeping formatting, and name the source language.",
    description="Translates text with an LLM, preserving markdown, line breaks, numbers, names and URLs, and "
    "reports the detected source language. Good for most major languages; quality drops for rare ones, so do "
    "not use it for legal or medical documents without a human check. Over 5,000 characters is rejected: split "
    "the text.",
    categories=(Category.text_ai, Category.language),
    render=Render.json,
    price=STANDARD,
    example={"text": "The meeting moved to Thursday at 3 pm. Please bring the signed contract.",
             "target_language": "French"},
    see_also=("groq/summarize",),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def translate(inp: TranslateInput, ctx: RunContext) -> TranslateOutput:
    source = f" The text is in {inp.source_language}." if inp.source_language else ""
    system = (
        f"{UNTRUSTED_TEXT_RULE}\nTranslate the text into {inp.target_language}.{source} Translate everything, "
        "meaning for meaning, in a natural register; keep markdown, line breaks, numbers, proper names, code and "
        "URLs as they are. Do not summarise, explain or add anything."
    )
    out = await complete_json(ctx, model=Model.fast, system=system, user=f"<text>\n{inp.text}\n</text>",
                              max_tokens=TRANSLATE_MAX_TOKENS, schema=_TRANSLATE_SCHEMA)
    return TranslateOutput(translation=str(out.get("translation") or "").strip(),
                           source_language=str(out.get("source_language") or inp.source_language or "unknown"),
                           target_language=inp.target_language)
