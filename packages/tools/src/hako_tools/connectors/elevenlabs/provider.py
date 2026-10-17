"""ElevenLabs REST API (elevenlabs.io/docs/api-reference, checked 2026-10-17), `xi-api-key` header.

Hako's key may synthesise speech and sound effects but not list voices (`voices_read` is not granted), so the voices
offered are ElevenLabs' public premade ones by id.
"""

from hako_tools.categories import Category
from hako_tools.framework import Header, Provider, Terms

ELEVENLABS = Provider(
    id="elevenlabs",
    display_name="ElevenLabs",
    summary="Lifelike speech in 30+ languages and sound effects from a text prompt, as MP3 kept for 24 hours.",
    homepage="https://elevenlabs.io",
    docs_url="https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
    base_url="https://api.elevenlabs.io/v1",
    categories=(Category.text_ai, Category.language),
    terms=Terms.allowed,
    auth=Header("xi-api-key", "ELEVENLABS_API_KEY"),
    max_concurrency=2,  # Starter plan: 3 concurrent requests per account; keep one free for the dashboard
)
