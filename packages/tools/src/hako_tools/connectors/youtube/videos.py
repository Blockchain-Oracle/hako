"""youtube/video: a public video's title, channel and thumbnail from YouTube's oEmbed endpoint."""

import re
from typing import Any

from pydantic import Field, field_validator

from hako_tools.connectors.youtube.provider import YOUTUBE
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import (
    LOCAL,
    Category,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolNotFoundResult,
    ToolOutput,
    tool,
)

VIDEO_INPUT_MAX_CHARS = 500
_ID = r"[A-Za-z0-9_-]{11}"  # every YouTube video id is 11 characters of this alphabet
_BARE_ID = re.compile(rf"^{_ID}$")
_ID_IN_URL = re.compile(rf"(?:[?&]v=|youtu\.be/|/shorts/|/embed/|/live/|/v/)({_ID})")
# oEmbed answers 400 for an id that does not exist, 401/403 for private or embedding-disabled videos.
_NO_PUBLIC_VIDEO = ("HTTP 400", "HTTP 401", "HTTP 403")
WATCH_URL = "https://www.youtube.com/watch?v="
EMBED_URL = "https://www.youtube.com/embed/"


class VideoInput(ToolInput):
    video: str = Field(min_length=11, max_length=VIDEO_INPUT_MAX_CHARS,
                       description="A YouTube link (watch, youtu.be, shorts, embed, live) or the 11-character id.")

    @field_validator("video")
    @classmethod
    def _video_id(cls, value: str) -> str:
        if _BARE_ID.match(value):
            return value
        if found := _ID_IN_URL.search(value):
            return found.group(1)
        raise ValueError("not a YouTube video link or id")


class VideoOutput(ToolOutput):
    video_id: str
    url: str
    title: str
    author_name: str | None = None
    author_url: str | None = None
    thumbnail_url: str | None = None
    thumbnail_width: int | None = None
    thumbnail_height: int | None = None
    embed_url: str
    provider: str = "YouTube"


@tool(
    provider=YOUTUBE,
    slug="video",
    name="YouTube Video Info",
    summary="Title, channel and thumbnail of a public YouTube video from its link or id (oEmbed).",
    description="Resolves any YouTube link (watch, youtu.be, shorts, embed, live) or bare video id to the "
    "video's title, channel name and URL, thumbnail and embed link, via YouTube's public oEmbed endpoint. "
    "Metadata only: it does not return transcripts, descriptions, view counts or comments (transcripts are not "
    "offered by Hako). Private, removed and embedding-disabled videos answer not found. To find videos about a "
    "topic use serper/search.",
    categories=(Category.web_extraction,),
    render=Render.json,
    price=LOCAL,
    example={"video": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    see_also=("serper/search", "firecrawl/scrape"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def video(inp: VideoInput, ctx: RunContext) -> VideoOutput:
    watch = f"{WATCH_URL}{inp.video}"
    try:
        data: dict[str, Any] = await ctx.get_json(YOUTUBE, "/oembed", params={"format": "json", "url": watch})
    except ProviderError as exc:
        if any(code in exc.message for code in _NO_PUBLIC_VIDEO):
            raise ToolNotFoundResult(f"No public, embeddable YouTube video has the id {inp.video}") from exc
        raise
    return VideoOutput(
        video_id=inp.video,
        url=watch,
        title=data.get("title") or "",
        author_name=data.get("author_name"),
        author_url=data.get("author_url"),
        thumbnail_url=data.get("thumbnail_url"),
        thumbnail_width=data.get("thumbnail_width"),
        thumbnail_height=data.get("thumbnail_height"),
        embed_url=f"{EMBED_URL}{inp.video}",
        provider=data.get("provider_name") or "YouTube",
    )
