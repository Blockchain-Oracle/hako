"""elevenlabs/sound-effect: a sound effect from a text prompt, at most 5 seconds (one fixed tier, R18)."""

from pydantic import Field

from hako_tools import files
from hako_tools.connectors.elevenlabs import budget
from hako_tools.connectors.elevenlabs.provider import ELEVENLABS
from hako_tools.connectors.elevenlabs.speech import MIME, OUTPUT_FORMAT, AudioOutput
from hako_tools.framework import Category, ProviderError, Render, RunContext, ToolInput, tool
from hako_tools.framework.pricing import MEDIA_SMALL

PROMPT_MAX_CHARS = 450  # ElevenLabs' sound-generation prompt limit
DURATION_MIN_S = 0.5
DURATION_MAX_S = 5.0  # the tier's ceiling: longer sounds cost more credits and take longer than a run allows
DURATION_DEFAULT_S = 3.0
PROMPT_INFLUENCE = 0.3  # ElevenLabs' default: follows the prompt while leaving room for variation
CREDITS_PER_S = 20  # the ceiling's estimate (measured ≈ 10 per second on 2026-10-17)


class SoundInput(ToolInput):
    text: str = Field(min_length=3, max_length=PROMPT_MAX_CHARS,
                      description="What it sounds like: 'a cash register ding', 'rain on a tin roof'.")
    duration_s: float = Field(DURATION_DEFAULT_S, ge=DURATION_MIN_S, le=DURATION_MAX_S,
                              description="Length in seconds, 0.5 to 5.")


@tool(
    provider=ELEVENLABS,
    slug="sound-effect",
    name="ElevenLabs Sound Effect",
    summary="Make a sound effect from a description (0.5–5 s), returned as an MP3 link kept 24 hours.",
    description="Generates a sound effect with ElevenLabs from a short description ('a cash register ding', 'crowd "
    "cheering in a stadium') at the length asked, 0.5 to 5 seconds, and returns a link to the MP3, kept for 24 hours. "
    "It does not make speech (elevenlabs/tts-500) or songs.",
    categories=(Category.text_ai,),
    render=Render.audio,
    price=MEDIA_SMALL,
    example={"text": "a soft cash register ding", "duration_s": 1.0},
    see_also=("elevenlabs/tts-500",),
)
async def sound_effect(inp: SoundInput, ctx: RunContext) -> AudioOutput:
    estimate = round(inp.duration_s * CREDITS_PER_S)
    with budget.held(estimate):
        audio, headers = await ctx.post_bytes(ELEVENLABS, "/sound-generation", params={"output_format": OUTPUT_FORMAT},
                                              json={"text": inp.text, "duration_seconds": inp.duration_s,
                                                    "prompt_influence": PROMPT_INFLUENCE})
    budget.record(headers, estimate)
    if not audio:
        raise ProviderError("ElevenLabs returned no audio")
    stored = files.save(audio, MIME)
    return AudioOutput(file_id=stored.id, url=stored.url, mime_type=MIME, kind="sound_effect",
                       expires_at=stored.expires_at, duration_s=inp.duration_s, text=inp.text, bytes=stored.bytes)
