"""news.db: an FTS5 index of GDELT headlines (72 h). Written by the ingest task, read-only by the API."""

import sqlite3
from contextlib import closing
from pathlib import Path

from hako_core.settings import get_settings
from hako_now.constants import NEWS_DB

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE VIRTUAL TABLE IF NOT EXISTS news USING fts5(
    title, url UNINDEXED, domain UNINDEXED, seen_at UNINDEXED, places, tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS seen (url TEXT PRIMARY KEY, seen_at INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
"""


def db_path() -> Path:
    return Path(get_settings().data_dir) / NEWS_DB


def connect_rw() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn


def connect_ro() -> sqlite3.Connection | None:
    path = db_path()
    if not path.exists():
        return None
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)


def meta(conn: sqlite3.Connection, key: str) -> str | None:
    with closing(conn.execute("SELECT value FROM meta WHERE key = ?", (key,))) as cur:
        row = cur.fetchone()
    return row[0] if row else None
