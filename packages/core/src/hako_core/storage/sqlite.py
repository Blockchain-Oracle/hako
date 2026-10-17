"""Read-only SQLite access from async code; reopens after the worker atomically swaps a file."""

import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import anyio

from hako_core.constants.cache import INDEX_RELOAD_CHECK_S, SQLITE_CACHE_KIB


class ReadOnlyIndex:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._local = threading.local()
        self._stamp: tuple[int, int] | None = None
        self._checked = 0.0

    def _file_stamp(self) -> tuple[int, int] | None:
        try:
            st = os.stat(self.path)
        except FileNotFoundError:
            return None
        return st.st_ino, int(st.st_mtime)

    def _conn(self) -> sqlite3.Connection:
        now = time.monotonic()
        if now - self._checked > INDEX_RELOAD_CHECK_S:
            self._checked = now
            stamp = self._file_stamp()
            if stamp != self._stamp:
                self._stamp = stamp
                self._local.__dict__.clear()  # force reopen in every thread
        conn: sqlite3.Connection | None = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=True)
            conn.execute(f"PRAGMA cache_size=-{SQLITE_CACHE_KIB}")
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return conn

    @property
    def available(self) -> bool:
        return self.path.exists()

    def _query(self, sql: str, params: tuple[Any, ...]) -> list[sqlite3.Row]:
        return self._conn().execute(sql, params).fetchall()

    async def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        return await anyio.to_thread.run_sync(self._query, sql, params)
