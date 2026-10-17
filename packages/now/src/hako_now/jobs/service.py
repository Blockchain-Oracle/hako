"""/jobs: search the local index of public ATS boards (never fetched live: boards are refreshed every 6 h)."""

import time
from contextlib import closing
from datetime import UTC, datetime

from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_now.constants import JOBS_STALE_INDEX_HOURS, SECONDS_PER_DAY, SECONDS_PER_HOUR
from hako_now.jobs import store
from hako_now.jobs.models import Job, JobsRequest
from hako_now.news.service import fts_query
from hako_now.provenance import Freshness, Provenance

INDEX_NAME = "ats-boards"
ATTRIBUTION = "Public job boards (Greenhouse, Lever, Ashby), indexed by Hako"


def _match(req: JobsRequest) -> str | None:
    parts = []
    if req.query:
        parts.append(fts_query(req.query))
    if req.companies:
        parts.append("(" + " OR ".join(f"company:{fts_query(c)}" for c in req.companies if fts_query(c)) + ")")
    if req.location:
        parts.append(f"location:{fts_query(req.location)}")
    return " AND ".join(p for p in parts if p and p != "()") or None


def search(req: JobsRequest) -> tuple[list[Job], int | None]:
    conn = store.connect_ro()
    if conn is None:
        return [], None
    since = int(time.time()) - req.posted_within_days * SECONDS_PER_DAY
    where: list[str] = ["(posted_at IS NULL OR posted_at >= ?)"]
    args: list[object] = [since]
    if (match := _match(req)) is not None:
        where.insert(0, "jobs MATCH ?")
        args.insert(0, match)
    if req.remote is not None:
        where.append("remote = 1" if req.remote else "(remote IS NULL OR remote = 0)")
    if req.salary_min is not None:
        where.append("salary_min >= ?")
        args.append(req.salary_min)
    if req.currency:
        where.append("currency = ?")
        args.append(req.currency.upper())
    order = "bm25(jobs), posted_at DESC" if match else "posted_at DESC"
    sql = (
        "SELECT title, company, location, department, ats, remote, salary, salary_min, currency, posted_at, url"
        f" FROM jobs WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?"
    )
    with closing(conn):
        rows = conn.execute(sql, (*args, req.limit)).fetchall()
        refreshed = conn.execute("SELECT min(refreshed_at) FROM boards WHERE error IS NULL").fetchone()[0]
    index_as_of = datetime.fromtimestamp(refreshed, UTC).isoformat() if refreshed else None
    age = int(time.time()) - refreshed if refreshed else None
    fresh = Freshness.fresh if age is not None and age <= JOBS_STALE_INDEX_HOURS * SECONDS_PER_HOUR else Freshness.stale
    return [
        Job(
            title=title,
            company=company,
            location=location,
            department=department,
            remote=bool(remote) if remote is not None else None,
            salary=salary,
            salary_min=salary_min,
            currency=currency,
            posted_at=datetime.fromtimestamp(posted, UTC).date().isoformat() if posted else None,
            url=url,
            ats=ats_name,
            provenance=Provenance(
                sources=[ats_name], as_of=index_as_of, age_seconds=age, freshness=fresh, attribution=ATTRIBUTION
            ),
        )
        for title, company, location, department, ats_name, remote, salary, salary_min, currency, posted, url in rows
    ], age


def get_jobs(req: JobsRequest) -> tuple[list[Job], list[SourceRef], list[str], list[str]]:
    jobs, age = search(req)
    if age is None:
        return (
            [],
            [SourceRef(name=INDEX_NAME, status=SourceStatus.unavailable)],
            [INDEX_NAME],
            ["the jobs index is empty"],
        )
    notes = ["salary filters only match postings that state a salary (Greenhouse boards rarely do)"]
    if age > JOBS_STALE_INDEX_HOURS * SECONDS_PER_HOUR:
        notes.append(f"the jobs index is {age // SECONDS_PER_HOUR} hours old")
    return jobs, [SourceRef(name=INDEX_NAME, status=SourceStatus.ok, attribution=ATTRIBUTION)], [], notes
