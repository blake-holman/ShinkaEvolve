"""Read-only SQLite access with retries and change-aware caching.

Evolution runs write to the database while the dashboard reads it, so reads
can hit ``database is locked`` or transient I/O errors.  :func:`with_retries`
retries those with growing delays.  :class:`ReadCache` stores results keyed by
the database file's identity (path, size, modification time, including the
write-ahead log) so a cached answer is reused only while the file is unchanged.
"""

from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Hashable, Iterator, Tuple, TypeVar

from shinka.database import DatabaseConfig, ProgramDatabase
from shinka.database import SystemPromptConfig, SystemPromptDatabase

from .responses import ServiceUnavailable

logger = logging.getLogger("shinka.webui")

T = TypeVar("T")

RETRYABLE_FRAGMENTS = ("database is locked", "busy", "disk i/o error")


def is_retryable(error: Exception) -> bool:
    text = str(error).lower()
    return any(fragment in text for fragment in RETRYABLE_FRAGMENTS)


def with_retries(
    operation: Callable[[], T],
    *,
    attempts: int = 8,
    initial_delay: float = 0.2,
    max_delay: float = 5.0,
    description: str = "database read",
) -> T:
    """Run ``operation`` and retry on transient SQLite errors.

    Raises :class:`ServiceUnavailable` once the attempts are exhausted and
    re-raises any non-transient database error unchanged.
    """
    delay = initial_delay
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except (sqlite3.OperationalError, sqlite3.DatabaseError) as error:
            if not is_retryable(error):
                raise
            if attempt == attempts:
                logger.warning(
                    "%s still busy after %d attempts: %s", description, attempts, error
                )
                raise ServiceUnavailable(
                    "Database temporarily unavailable - evolution may be running"
                ) from error
            logger.debug(
                "%s busy (attempt %d/%d), retrying in %.1fs: %s",
                description,
                attempt,
                attempts,
                delay,
                error,
            )
            time.sleep(delay)
            delay = min(delay * 1.5, max_delay)
    raise AssertionError("unreachable")


@contextlib.contextmanager
def open_program_db(db_file: Path) -> Iterator[ProgramDatabase]:
    """Open a program database read-only and close it afterwards."""
    db = ProgramDatabase(DatabaseConfig(db_path=str(db_file)), read_only=True)
    try:
        if db.cursor:
            db.cursor.execute("PRAGMA busy_timeout = 30000;")
        yield db
    finally:
        with contextlib.suppress(Exception):
            db.close()


@contextlib.contextmanager
def open_prompt_db(db_file: Path) -> Iterator[SystemPromptDatabase]:
    db = SystemPromptDatabase(SystemPromptConfig(db_path=str(db_file)), read_only=True)
    try:
        if db.cursor:
            db.cursor.execute("PRAGMA busy_timeout = 30000;")
        yield db
    finally:
        with contextlib.suppress(Exception):
            db.close()


@contextlib.contextmanager
def open_sqlite_readonly(
    db_file: Path, *, timeout: float = 5.0
) -> Iterator[sqlite3.Connection]:
    """Plain read-only sqlite3 connection with row access by name."""
    uri = f"file:{db_file.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=timeout, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(f"PRAGMA busy_timeout = {int(timeout * 1000)};")
        yield conn
    finally:
        with contextlib.suppress(Exception):
            conn.close()


def file_signature(db_file: Path) -> Tuple[Any, ...]:
    """Identity of a SQLite file's content: size and mtime of it and its WAL."""
    parts = []
    for candidate in (db_file, db_file.with_name(db_file.name + "-wal")):
        try:
            stat = os.stat(candidate)
            parts.append((stat.st_size, stat.st_mtime_ns))
        except FileNotFoundError:
            parts.append(None)
    return tuple(parts)


class ReadCache:
    """Cache computed values until the backing database file changes.

    A short grace period avoids re-reading a large database many times per
    second when several browser tabs poll at once; after it expires the file
    signature is checked again and the entry is reused only if unchanged.
    """

    def __init__(self, grace_seconds: float = 1.0):
        self.grace_seconds = grace_seconds
        self._entries: Dict[Hashable, Tuple[float, Tuple[Any, ...], Any]] = {}
        self._lock = threading.Lock()

    def get_or_compute(
        self, key: Hashable, db_file: Path, compute: Callable[[], T]
    ) -> T:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
        if entry is not None:
            cached_at, signature, value = entry
            if now - cached_at < self.grace_seconds:
                return value
            if signature == file_signature(db_file):
                with self._lock:
                    self._entries[key] = (now, signature, value)
                return value
        signature = file_signature(db_file)
        value = compute()
        with self._lock:
            self._entries[key] = (time.monotonic(), signature, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
