"""jobs.db: FTS5 over job postings from public ATS boards. Written by `hako-task jobs`, read-only by the API."""

import sqlite3
from pathlib import Path

from hako_core.settings import get_settings
from hako_now.constants import JOBS_DB

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE VIRTUAL TABLE IF NOT EXISTS jobs USING fts5(
    title, company, location, department,
    board UNINDEXED, ats UNINDEXED, remote UNINDEXED, salary UNINDEXED, salary_min UNINDEXED,
    currency UNINDEXED, posted_at UNINDEXED, url UNINDEXED, tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS boards (board TEXT PRIMARY KEY, ats TEXT, jobs INTEGER, refreshed_at INTEGER, error TEXT)
    WITHOUT ROWID;
"""


def db_path() -> Path:
    return Path(get_settings().data_dir) / JOBS_DB


def connect_rw() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn


def connect_ro() -> sqlite3.Connection | None:
    path = db_path()
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False) if path.exists() else None
