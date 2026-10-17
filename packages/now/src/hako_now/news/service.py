"""/news: the local GDELT headline index (bm25 × recency) and live Hacker News, merged and de-duplicated."""

import re
import time
from datetime import UTC, datetime
from functools import cache
from itertools import zip_longest
from urllib.parse import quote, urlsplit

import anyio
from rapidfuzz import fuzz

from hako_core.constants.deadlines import NOW_DEADLINE_S
from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.deadline import current_deadline
from hako_core.fanout import fan_out
from hako_core.http.client import UpstreamClient
from hako_now import clients
from hako_now.constants import (
    GDELT,
    HN,
    NEWS_DEDUPE_TITLE_MIN,
    NEWS_RECENCY_WEIGHT_PER_HOUR,
    SECONDS_PER_HOUR,
)
from hako_now.news import store
from hako_now.news.ingest import LAST_FILE
from hako_now.news.models import NewsRequest, NewsStory
from hako_now.provenance import Freshness, Provenance, age_seconds
from hako_now.time.zones import countries

hn_client = cache(lambda: UpstreamClient(HN))
clients.register(hn_client)
_WORD_RE = re.compile(r"[\w'-]+", re.UNICODE)
GDELT_FILE_TS = re.compile(r"/(\d{14})\.gkg")
FRESH_INDEX_MAX_S = 2 * 15 * 60  # two ingest cycles
HN_BASE = "https://news.ycombinator.com/item?id="


def fts_query(text: str) -> str:
    """Every word must appear (quoted tokens: no FTS5 operators from user input)."""
    return " ".join(f'"{w}"' for w in _WORD_RE.findall(text.replace('"', " ")))


def _search_index(req: NewsRequest) -> tuple[list[NewsStory], str | None]:
    conn = store.connect_ro()
    if conn is None:
        return [], None
    since = int(time.time()) - req.since_hours * SECONDS_PER_HOUR
    now = int(time.time())
    sql = (
        "SELECT title, url, domain, seen_at FROM news WHERE news MATCH ? AND seen_at >= ?"
        " ORDER BY bm25(news) + (? - seen_at) * ? LIMIT ?"
    )
    match = fts_query(req.query)
    if req.country and (name := countries().get(req.country.upper())):
        match = f'{match} places:"{name}"'
    with conn:
        rows = conn.execute(
            sql, (match, since, now, NEWS_RECENCY_WEIGHT_PER_HOUR / SECONDS_PER_HOUR, req.limit)
        ).fetchall()
        last_file = store.meta(conn, LAST_FILE)
    conn.close()
    return [
        NewsStory(
            title=title,
            url=url,
            domain=domain,
            seen_at=datetime.fromtimestamp(int(seen), UTC).isoformat(),
            source="gdelt",
            provenance=Provenance(
                sources=["gdelt"],
                as_of=datetime.fromtimestamp(int(seen), UTC).isoformat(),
                age_seconds=now - int(seen),
                freshness=Freshness.fresh,
                licence=GDELT.licence,
                attribution=GDELT.attribution,
            ),
        )
        for title, url, domain, seen in rows
    ], last_file


async def _search_hn(req: NewsRequest) -> list[NewsStory]:
    since = int(time.time()) - req.since_hours * SECONDS_PER_HOUR
    data, _ = await hn_client().get_json(
        f"/api/v1/search?query={quote(req.query)}&tags=story&hitsPerPage={req.limit}"
        f"&numericFilters=created_at_i>{since}&typoTolerance=false"  # else "election" matches "Evictions"
    )
    stories = []
    for h in data.get("hits", []):
        url = h.get("url") or f"{HN_BASE}{h['objectID']}"
        created = datetime.fromtimestamp(h["created_at_i"], UTC)
        stories.append(
            NewsStory(
                title=h.get("title") or "",
                url=url,
                domain=urlsplit(url).hostname or "news.ycombinator.com",
                seen_at=created.isoformat(),
                source="hn",
                points=h.get("points"),
                provenance=Provenance(
                    sources=["hn"],
                    as_of=created.isoformat(),
                    age_seconds=age_seconds(created),
                    freshness=Freshness.fresh,
                    attribution=HN.attribution,
                ),
            )
        )
    return stories


def merge(gdelt: list[NewsStory], hn: list[NewsStory], limit: int) -> list[NewsStory]:
    """Interleave the two ranked lists; the same URL or a near-identical headline (token_set_ratio ≥
    NEWS_DEDUPE_TITLE_MIN) is one story, marked `also_in` the other source."""
    out: list[NewsStory] = []
    interleaved = [s for pair in zip_longest(gdelt, hn) for s in pair if s is not None]  # keep each source's ranking
    for story in interleaved:
        twin = next(
            (
                o
                for o in out
                if o.url == story.url or fuzz.token_set_ratio(o.title, story.title) >= NEWS_DEDUPE_TITLE_MIN
            ),
            None,
        )
        if twin is None:
            out.append(story)
        elif story.source not in twin.also_in and story.source != twin.source:
            twin.also_in.append(story.source)
    return out[:limit]


def _index_age_s(last_file: str | None) -> int | None:
    if not last_file or not (m := GDELT_FILE_TS.search(last_file)):
        return None
    return age_seconds(datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=UTC))


async def get_news(req: NewsRequest) -> tuple[list[NewsStory], list[SourceRef], list[str], list[str]]:
    got = await fan_out(
        {"gdelt": anyio.to_thread.run_sync(_search_index, req), "hn": _search_hn(req)},
        current_deadline(NOW_DEADLINE_S),
    )
    refs: list[SourceRef] = []
    unavailable: list[str] = []
    notes: list[str] = []
    index: tuple[list[NewsStory], str | None] = got.ok.get("gdelt") or ([], None)  # type: ignore[assignment]
    gdelt_stories, last_file = index
    index_age = _index_age_s(last_file)
    if "gdelt" in got.ok and last_file is not None:
        refs.append(
            SourceRef(name="gdelt", status=SourceStatus.ok, licence=GDELT.licence, attribution=GDELT.attribution)
        )
        if index_age is not None and index_age > FRESH_INDEX_MAX_S:
            notes.append(f"the GDELT index is {index_age // 60} minutes old")
    else:
        refs.append(SourceRef(name="gdelt", status=SourceStatus.unavailable))
        unavailable.append("gdelt")
    hn_stories = got.ok.get("hn") or []
    refs.append(SourceRef(name="hn", status=SourceStatus.ok if "hn" in got.ok else SourceStatus.unavailable))
    if "hn" not in got.ok:
        unavailable.append("hn")
    notes.append("headlines only (English-language GDELT feed + Hacker News); follow the URL for the article")
    return merge(gdelt_stories, hn_stories, req.limit), refs, unavailable, notes  # type: ignore[arg-type]
