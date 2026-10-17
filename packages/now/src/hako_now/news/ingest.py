"""GDELT GKG → news.db. Run by a scheduled task every 15 minutes (`hako-task gdelt`)."""

import csv
import html
import io
import re
import sqlite3
import time
import zipfile
from contextlib import closing
from datetime import UTC, datetime
from functools import cache
from http import HTTPStatus
from typing import Any

import anyio
import structlog

from hako_core.deadline import Deadline, set_deadline
from hako_core.http.client import UpstreamClient
from hako_now.constants import (
    GDELT,
    GKG_COLUMNS,
    GKG_DATE,
    GKG_DOMAIN,
    GKG_EXTRAS,
    GKG_LOCATIONS,
    GKG_URL,
    NEWS_INGEST_BUDGET_S,
    NEWS_INSERT_BATCH,
    NEWS_RETENTION_HOURS,
    NEWS_TITLE_MAX_CHARS,
    SECONDS_PER_HOUR,
)
from hako_now.news import store

log = structlog.get_logger(__name__)
client = cache(lambda: UpstreamClient(GDELT))
_TITLE_RE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)
LAST_FILE = "gdelt_last_file"
GKG_MARK = ".gkg.csv.zip"
LOCATION_FIELDS = 2  # "type#Full name#FIPS#..." → keep the full name ("Tennessee, United States")


def _places(field: str) -> str:
    names = {part.split("#")[1] for part in field.split(";") if part.count("#") >= LOCATION_FIELDS}
    return " ; ".join(sorted(names))


def parse(blob: bytes) -> list[tuple[str, str, str, int, str]]:
    """(title, url, domain, seen_at epoch, places) for rows with a page title."""
    csv.field_size_limit(len(blob))
    rows = []
    with zipfile.ZipFile(io.BytesIO(blob)) as z, z.open(z.namelist()[0]) as raw:
        for cols in csv.reader(
            io.TextIOWrapper(raw, encoding="utf-8", errors="replace"), delimiter="\t", quoting=csv.QUOTE_NONE
        ):
            if len(cols) < GKG_COLUMNS or not (m := _TITLE_RE.search(cols[GKG_EXTRAS])):
                continue
            title = " ".join(html.unescape(m.group(1)).split())[:NEWS_TITLE_MAX_CHARS]
            seen = int(datetime.strptime(cols[GKG_DATE], "%Y%m%d%H%M%S").replace(tzinfo=UTC).timestamp())
            rows.append((title, cols[GKG_URL], cols[GKG_DOMAIN], seen, _places(cols[GKG_LOCATIONS])))
    return rows


def _store(rows: list[tuple[str, str, str, int, str]], file_url: str) -> dict[str, int]:
    cutoff = int(time.time()) - NEWS_RETENTION_HOURS * SECONDS_PER_HOUR
    inserted = 0
    with closing(store.connect_rw()) as conn:
        for start in range(0, len(rows), NEWS_INSERT_BATCH):
            with conn:
                for title, url, domain, seen, places in rows[start : start + NEWS_INSERT_BATCH]:
                    try:
                        conn.execute("INSERT INTO seen (url, seen_at) VALUES (?, ?)", (url, seen))
                    except sqlite3.IntegrityError:
                        continue  # already indexed from an earlier file
                    conn.execute(
                        "INSERT INTO news (title, url, domain, seen_at, places) VALUES (?, ?, ?, ?, ?)",
                        (title, url, domain, seen, places),
                    )
                    inserted += 1
        with conn:
            pruned = conn.execute("DELETE FROM news WHERE seen_at < ?", (cutoff,)).rowcount
            conn.execute("DELETE FROM seen WHERE seen_at < ?", (cutoff,))
            conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (LAST_FILE, file_url))
        total = conn.execute("SELECT count(*) FROM seen").fetchone()[0]
    return {"inserted": inserted, "pruned": pruned, "total": total}


async def run() -> dict[str, Any]:
    set_deadline(Deadline(NEWS_INGEST_BUDGET_S))
    listing = await client().request("GET", "/gdeltv2/lastupdate.txt")
    url = next((line.split()[-1] for line in listing.text.splitlines() if line.endswith(GKG_MARK)), None)
    if url is None:
        return {"status": "no_gkg_file"}
    url = url.replace("http://", "https://", 1)  # the listing links http; the host serves https
    with closing(store.connect_rw()) as conn:
        if store.meta(conn, LAST_FILE) == url:
            return {"status": "up_to_date", "file": url}
    resp = await client().request("GET", url.removeprefix(GDELT.base_url))
    if resp.status_code == HTTPStatus.NOT_FOUND:  # listed before the CDN serves it: the next run picks it up
        return {"status": "file_not_ready", "file": url}
    resp.raise_for_status()
    rows = await anyio.to_thread.run_sync(parse, resp.content)
    stats = await anyio.to_thread.run_sync(_store, rows, url)
    log.info("gdelt_ingested", file=url, parsed=len(rows), **stats)
    return {"status": "ok", "file": url, "parsed": len(rows), **stats}
