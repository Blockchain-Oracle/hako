"""nasa/apod: one Astronomy Picture of the Day, read from its science.nasa.gov article (see provider.py)."""

import datetime as dt
import html
import re
from typing import Any, Self

from pydantic import Field, model_validator

from hako_tools.connectors.nasa.provider import NASA, NASA_SCIENCE
from hako_tools.constants import TTL_PAGE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

FIRST_APOD = dt.date(1995, 6, 16)
EXPLANATION_CHARS = 2_500
CANDIDATES = 2  # posts fetched per call: an unrelated article that mentions "APOD" must not displace the real one
ARTICLES_PATH = "/wp-json/wp/v2/image-article"
FIELDS = "date,link,title,content,_links,_embedded"
TITLE_PREFIX = "APOD:"
_TAG = re.compile(r"<[^>]+>")
_TITLE_DATE = re.compile(r"^APOD:\s*\d{4}\s+\w+\s+\d{1,2}\s*[–—-]\s*")
_EXPLANATION = re.compile(r'media-detail-hero__description[^>]*>(.*?)</p>', re.DOTALL)
_META_ROW = re.compile(r"<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>", re.DOTALL)
_IFRAME = re.compile(r'<iframe[^>]+src="([^"]+)"')
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([.,;:!?)])")  # left behind where a link ended just before punctuation
_CREDIT_PREFIX = re.compile(r"^(?:Image\s+)?Credit(?:\s*(?:&|and)\s*(?:Copyright|License))?:?\s*", re.IGNORECASE)
_TOMORROW = re.compile(r"Tomorrow[’']s picture:.*$", re.DOTALL)


class ApodInput(ToolInput):
    date: dt.date | None = Field(None, description="YYYY-MM-DD from 1995-06-16 on; omit for the latest picture.")

    @model_validator(mode="after")
    def _in_range(self) -> Self:
        if self.date and not FIRST_APOD <= self.date <= dt.datetime.now(dt.UTC).date() + dt.timedelta(days=1):
            raise ValueError(f"APOD runs from {FIRST_APOD.isoformat()} to today")
        return self


class ApodOutput(ToolOutput):
    date: str
    title: str
    explanation: str | None = None
    media_type: str  # image | video | other
    url: str | None = None  # the image, or the video's embed URL
    credit: str | None = None
    copyrighted: bool = False  # the credit line claims copyright: link to the image, do not republish it
    page_url: str


def _plain(fragment: str) -> str:
    return _SPACE_BEFORE_PUNCT.sub(r"\1", " ".join(html.unescape(_TAG.sub("", fragment)).split()))


def _credit(content: str) -> tuple[str | None, bool]:
    for label, value in _META_ROW.findall(content):
        name, text = _plain(label), _plain(value)
        if "Credit" in name:
            return _CREDIT_PREFIX.sub("", text) or None, "Copyright" in name or "Copyright" in text
    return None, False


def _media(post: dict[str, Any], content: str) -> tuple[str, str | None]:
    if frame := _IFRAME.search(content):
        return "video", frame.group(1)
    media = ((post.get("_embedded") or {}).get("wp:featuredmedia") or [{}])[0]
    if media.get("source_url"):
        return media.get("media_type") or "image", media["source_url"]
    return "other", None


@tool(
    provider=NASA,
    slug="apod",
    name="NASA Astronomy Picture of the Day",
    summary="NASA's Astronomy Picture of the Day for a date (or today): title, explanation, image URL and credit.",
    description="Returns one APOD: its title, the astronomer-written explanation, the image (or video embed) URL, "
    "the credit line and whether that credit claims copyright, plus the page link. Any date since 1995-06-16; "
    "omit the date for the latest. Many APOD images belong to their photographers: show or link them with the "
    "credit, and do not treat them as public domain. For asteroid fly-bys use nasa/asteroids.",
    categories=(Category.science,),
    render=Render.json,
    price=LOCAL,
    example={"date": "2025-01-01"},
    see_also=("nasa/asteroids", "wikipedia/summary"),
    cache_ttl_s=TTL_PAGE_S,
)
async def apod(inp: ApodInput, ctx: RunContext) -> ApodOutput:
    params: dict[str, Any] = {"search": "APOD", "per_page": CANDIDATES, "orderby": "date", "order": "desc",
                              "_embed": "wp:featuredmedia", "_fields": FIELDS}
    if inp.date:  # WordPress date bounds are exclusive
        params["after"] = f"{(inp.date - dt.timedelta(days=1)).isoformat()}T23:59:59"
        params["before"] = f"{(inp.date + dt.timedelta(days=1)).isoformat()}T00:00:00"
    posts = await ctx.get_json(NASA_SCIENCE, ARTICLES_PATH, params=params)
    post = next((p for p in posts or [] if _plain((p.get("title") or {}).get("rendered", "")).startswith(TITLE_PREFIX)),
                None)
    if not post:
        raise ToolNotFoundResult(f"No Astronomy Picture of the Day found for {inp.date or 'today'}")
    content = (post.get("content") or {}).get("rendered") or ""
    explanation = _EXPLANATION.search(content)
    text = _TOMORROW.sub("", _plain(explanation.group(1))).removeprefix("Explanation:").strip() if explanation else None
    credit, copyrighted = _credit(content)
    media_type, url = _media(post, content)
    return ApodOutput(
        date=str(post.get("date", ""))[:10],
        title=_TITLE_DATE.sub("", _plain(post["title"]["rendered"])),
        explanation=text[:EXPLANATION_CHARS] if text else None,
        media_type=media_type,
        url=url,
        credit=credit,
        copyrighted=copyrighted,
        page_url=post.get("link", ""),
    )
