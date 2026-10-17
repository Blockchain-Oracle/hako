"""Refresh every board in data/job_boards.json into jobs.db (`hako-task jobs`, every 6 h)."""

import json
import time
from contextlib import closing
from functools import cache
from importlib import resources
from typing import Any

import anyio
import structlog

from hako_core.deadline import Deadline, set_deadline
from hako_core.errors import UpstreamFailure
from hako_core.fanout import gather_limited
from hako_core.http.client import UpstreamClient
from hako_now.constants import ASHBY, GREENHOUSE, JOBS_BOARD_CONCURRENCY, JOBS_INGEST_BUDGET_S, LEVER
from hako_now.jobs import ats, store

log = structlog.get_logger(__name__)
_clients = {
    "greenhouse": cache(lambda: UpstreamClient(GREENHOUSE)),
    "lever": cache(lambda: UpstreamClient(LEVER)),
    "ashby": cache(lambda: UpstreamClient(ASHBY)),
}
_PATHS = {
    "greenhouse": "/v1/boards/{slug}/jobs",
    "lever": "/v0/postings/{slug}?mode=json",
    "ashby": "/posting-api/job-board/{slug}?includeCompensation=true",
}
_PARSERS = {"greenhouse": ats.greenhouse, "lever": ats.lever, "ashby": ats.ashby}


def boards() -> dict[str, str]:
    return json.loads(resources.files("hako_now.data").joinpath("job_boards.json").read_text())


async def _fetch(slug: str, kind: str) -> tuple[str, str, list[ats.JobRow] | None, str | None]:
    try:
        data, _ = await _clients[kind]().get_json(_PATHS[kind].format(slug=slug))
    except UpstreamFailure as failure:
        return slug, kind, None, failure.kind
    return slug, kind, _PARSERS[kind](slug, data), None


def _write(results: list[tuple[str, str, list[ats.JobRow] | None, str | None]]) -> dict[str, int]:
    now = int(time.time())
    written = failed = 0
    with closing(store.connect_rw()) as conn, conn:
        for slug, kind, rows, error in results:
            if rows is None:  # keep the last good snapshot of a board that failed this round
                conn.execute("UPDATE boards SET error = ? WHERE board = ?", (error, slug))
                failed += 1
                continue
            conn.execute("DELETE FROM jobs WHERE board = ?", (slug,))
            conn.executemany(
                "INSERT INTO jobs (title, company, location, department, board, ats, remote, salary, salary_min,"
                " currency, posted_at, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        r.title,
                        r.company,
                        r.location,
                        r.department,
                        slug,
                        kind,
                        r.remote,
                        r.salary,
                        r.salary_min,
                        r.currency,
                        r.posted_at,
                        r.url,
                    )
                    for r in rows
                ],
            )
            conn.execute(
                "INSERT OR REPLACE INTO boards (board, ats, jobs, refreshed_at, error) VALUES (?, ?, ?, ?, NULL)",
                (slug, kind, len(rows), now),
            )
            written += len(rows)
    return {"jobs": written, "boards_failed": failed}


async def run() -> dict[str, Any]:
    set_deadline(Deadline(JOBS_INGEST_BUDGET_S))
    listing = boards()
    outcomes = await gather_limited((_fetch(s, k) for s, k in listing.items()), JOBS_BOARD_CONCURRENCY)
    results = [o for o in outcomes if not isinstance(o, BaseException)]
    stats = await anyio.to_thread.run_sync(_write, results)
    for client in _clients.values():
        if client.cache_info().currsize:
            await client().aclose()
    log.info("jobs_ingested", boards=len(listing), **stats)
    return {"status": "ok", "boards": len(listing), **stats}
