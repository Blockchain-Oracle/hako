"""elevenlabs/tts-500 and elevenlabs/tts-2000: text to speech as MP3, two fixed tiers by length (plan B11, R18)."""

from enum import StrEnum

from pydantic import Field

from hako_tools import files
from hako_tools.connectors.elevenlabs import budget
from hako_tools.connectors.elevenlabs.provider import ELEVENLABS
from hako_tools.framework import Category, ProviderError, Render, RunContext, ToolInput, ToolOutput, tool
from hako_tools.framework.pricing import MEDIA_LARGE, MEDIA_MEDIUM

MODEL = "eleven_flash_v2_5"  # ~75 ms latency, 32 languages, the cheapest per character
OUTPUT_FORMAT = "mp3_44100_128"
MP3_BITS_PER_S = 128_000  # constant bit rate of OUTPUT_FORMAT: duration = bytes × 8 / bit rate
BITS_PER_BYTE = 8
DURATION_PLACES = 1
CREDITS_PER_CHAR = 1  # the ceiling's estimate: Flash bills 0.5, so this never under-counts
SHORT_MAX_CHARS = 500
LONG_MAX_CHARS = 2_000
MIME = "audio/mpeg"


class Voice(StrEnum):
    """ElevenLabs premade voices (public ids; each answered 200 for Hako's key on 2026-10-17, Sarah did not)."""

    george = "George"
    rachel = "Rachel"
    alice = "Alice"
    liam = "Liam"
    matilda = "Matilda"
    adam = "Adam"


VOICE_IDS: dict[Voice, str] = {
    Voice.george: "JBFqnCBsd6RMkjVDRZzb",  # British, warm narrator
    Voice.rachel: "21m00Tcm4TlvDq8ikWAM",  # American, calm
    Voice.alice: "Xb7hH8MSUJpSbSDYk0k2",  # British, confident
    Voice.liam: "TX3LPaxmHKxFdv7VOQHJ",  # American, articulate
    Voice.matilda: "XrExE9yKIg1WjnnlVkGX",  # American, friendly
    Voice.adam: "pNInz6obpgDQGcFmaJgB",  # American, deep
}
VOICE_TEXT = "Voice: George (British narrator, default), Rachel, Alice, Liam, Matilda or Adam."


class ShortSpeechInput(ToolInput):
    text: str = Field(min_length=1, max_length=SHORT_MAX_CHARS, description="Up to 500 characters to read aloud.")
    voice: Voice = Field(Voice.george, description=VOICE_TEXT)


class LongSpeechInput(ToolInput):
    text: str = Field(min_length=1, max_length=LONG_MAX_CHARS, description="Up to 2,000 characters to read aloud.")
    voice: Voice = Field(Voice.george, description=VOICE_TEXT)


class AudioOutput(ToolOutput):
    file_id: str
    url: str = Field(description="The MP3, kept 24 hours.")
    mime_type: str
    kind: str = Field(description="speech or sound_effect.")
    expires_at: str
    duration_s: float | None = None
    text: str | None = None
    voice: str | None = None
    model: str | None = None
    bytes: int | None = None


async def _speak(text: str, voice: Voice, ctx: RunContext) -> AudioOutput:
    estimate = len(text) * CREDITS_PER_CHAR
    with budget.held(estimate):
        audio, headers = await ctx.post_bytes(ELEVENLABS, f"/text-to-speech/{VOICE_IDS[voice]}",
                                              params={"output_format": OUTPUT_FORMAT},
                                              json={"text": text, "model_id": MODEL})
    budget.record(headers, estimate)
    if not audio:
        raise ProviderError("ElevenLabs returned no audio")
    stored = files.save(audio, MIME)
    return AudioOutput(file_id=stored.id, url=stored.url, mime_type=MIME, kind="speech", expires_at=stored.expires_at,
                       duration_s=round(len(audio) * BITS_PER_BYTE / MP3_BITS_PER_S, DURATION_PLACES), text=text,
                       voice=voice.value, model=MODEL, bytes=stored.bytes)


DESCRIPTION = ("Reads text aloud with an ElevenLabs voice (Flash v2.5: 32 languages, detected from the text) and "
               "returns a link to the MP3, kept for 24 hours, with its length. {limit} Pick a voice by name: "
               "George (default), Rachel, Alice, Liam, Matilda, Adam. It does not clone voices or make music.")


@tool(
    provider=ELEVENLABS,
    slug="tts-500",
    name="ElevenLabs Speech (500 characters)",
    summary="Read up to 500 characters aloud in a natural ElevenLabs voice; returns an MP3 link kept 24 hours.",
    description=DESCRIPTION.format(limit="Up to 500 characters (a headline, a short answer); for longer text use "
                                   "elevenlabs/tts-2000."),
    categories=(Category.text_ai, Category.language),
    render=Render.audio,
    price=MEDIA_MEDIUM,
    example={"text": "Hako pays for your agent's tools with your PayBox wallet.", "voice": "George"},
    see_also=("elevenlabs/tts-2000", "elevenlabs/sound-effect"),
)
async def tts_500(inp: ShortSpeechInput, ctx: RunContext) -> AudioOutput:
    return await _speak(inp.text, inp.voice, ctx)


@tool(
    provider=ELEVENLABS,
    slug="tts-2000",
    name="ElevenLabs Speech (2,000 characters)",
    summary="Read up to 2,000 characters aloud in a natural ElevenLabs voice; returns an MP3 link kept 24 hours.",
    description=DESCRIPTION.format(limit="Up to 2,000 characters (a paragraph or a short article); for 500 or fewer "
                                   "elevenlabs/tts-500 costs less."),
    categories=(Category.text_ai, Category.language),
    render=Render.audio,
    price=MEDIA_LARGE,
    example={"text": "Hako gives your AI agent a box of paid tools and real money moves, paid and signed with your "
             "PayBox wallet, and shown as clickable cards wherever your agent lives.", "voice": "Rachel"},
    see_also=("elevenlabs/tts-500",),
)
async def tts_2000(inp: LongSpeechInput, ctx: RunContext) -> AudioOutput:
    return await _speak(inp.text, inp.voice, ctx)
