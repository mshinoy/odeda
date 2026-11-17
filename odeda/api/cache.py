"""Memoised analytics, kept until the data changes, and warmed ahead of the first ask.

The analytics behind Status, Trends, Reports and the Map's heatmap read the whole
history, so each costs about a second. Their answers only change when the database
does, so they are kept until it does.

"When the database changes" has to see every write. The store runs SQLite in WAL mode,
where a commit appends to `garmin.db-wal` and only a checkpoint, later, touches
`garmin.db` itself, so the main file's mtime alone misses most writes. The version is
the main file's mtime plus the WAL's size and mtime: a commit changes the WAL, and a
checkpoint changes the main file. That is two `stat` calls per lookup, with no expiry.

An *empty* WAL's mtime is left out. When the last connection closes, SQLite folds the
WAL into the main file and deletes it, and the next connection creates a new, empty
one: on a quiet server that is every request, and counting it would empty the cache
on every request without a single write.

The version also carries today's date. Some analytics are answers about *today* (the load
curve runs to it, the race countdown counts to it), so the same data gives a different
answer after midnight. Without the date, those answers would sit unchanged until the next
write, which on a quiet night is the next automatic sync. With it, the first request of
the new day recomputes them, and the warmer refreshes them without waiting to be asked.

A change empties the whole cache rather than marking entries stale: every entry
depends on the same data, and it keeps the dict from growing once per filter tried.

`CacheWarmer` recomputes what a page opens with (today, the unfiltered heatmap) once
the data has settled after a change, so the first visit after a sync finds it done.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

from ..config import Settings

log = logging.getLogger(__name__)

#: (main file mtime, WAL mtime, WAL size, today), in nanoseconds, bytes and an ISO date;
#: zeros for a missing or empty WAL.
DataVersion = tuple[int, int, int, str]

_cache: dict[str, Any] = {}
_cache_version: DataVersion | None = None
_lock = threading.Lock()


def _today() -> str:
    """The local date, as the analytics see it (`TZ`). A function so a test can move it."""
    return date.today().isoformat()


def data_version(settings: Settings) -> DataVersion:
    """What changes whenever anything is written to the database, or the date does."""
    main = _stat(settings.db_path)
    wal_mtime, wal_size = _stat(Path(f"{settings.db_path}-wal"))
    # An empty WAL holds nothing; it is created afresh by every first connection.
    return (main[0], wal_mtime if wal_size > 0 else 0, wal_size, _today())


def _stat(path: Path) -> tuple[int, int]:
    try:
        st = path.stat()
    except OSError:
        return (0, 0)
    return (st.st_mtime_ns, st.st_size)


def cached(settings: Settings, key: str, fn: Callable[[], Any]) -> Any:
    """`fn()`, computed once per data version and kept until the data changes."""
    global _cache_version
    version = data_version(settings)
    with _lock:
        if version != _cache_version:
            _cache.clear()
            _cache_version = version
        if key in _cache:
            return _cache[key]
    value = fn()
    with _lock:
        # Only keep it if no write landed while it was computed; otherwise it may
        # describe data that is already gone, and the next ask recomputes.
        if data_version(settings) == _cache_version == version:
            _cache[key] = value
    return value


def clear() -> None:
    global _cache_version
    with _lock:
        _cache.clear()
        _cache_version = None


class CacheWarmer:
    """Computes `warm()` at startup and again whenever the data has changed and then
    held still for one poll, while `is_busy()` is false.

    Waiting for the data to settle means a sync's hundreds of commits cost one warm-up
    at the end rather than one per commit, and checking `is_busy` keeps it off the
    database while a sync is writing to it.
    """

    def __init__(
        self,
        settings: Settings,
        warm: Callable[[], None],
        is_busy: Callable[[], bool],
        poll_s: float = 15.0,
    ) -> None:
        self.settings = settings
        self.warm = warm
        self.is_busy = is_busy
        self.poll_s = poll_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="ga-cache-warm", daemon=True)
        self._thread.start()

    def stop(self, timeout: float | None = 5.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def _loop(self) -> None:
        warmed: DataVersion | None = None
        seen = data_version(self.settings)
        while not self._stop.is_set():
            now = data_version(self.settings)
            settled = now == seen
            seen = now
            if settled and now != warmed and not self.is_busy():
                try:
                    self.warm()
                    warmed = now
                except Exception:  # pragma: no cover - the next ask computes it instead
                    log.exception("cache warm-up failed")
                    warmed = now
            self._stop.wait(self.poll_s)
