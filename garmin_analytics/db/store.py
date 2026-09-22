"""SQLite connection, migrations and idempotent upsert helpers.

Stdlib `sqlite3` only — no ORM, no sqlite3 CLI dependency.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Sequence

from ..config import Settings, load_settings
from . import fields as fields_mod

SCHEMA_VERSION = 2

#: Columns added to existing tables after v1 shipped. Applied with ALTER TABLE only
#: when missing, so upgrading a v1 database in place keeps its data.
ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("activity_samples", "lat", "REAL"),
    ("activity_samples", "lon", "REAL"),
)


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect(db_path: Path | str) -> sqlite3.Connection:
    """Open a connection with the pragmas we always want."""
    path = Path(db_path)
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def _add_missing_columns(conn: sqlite3.Connection) -> list[str]:
    """ALTER TABLE ADD COLUMN for anything in ADDED_COLUMNS not already present."""
    added: list[str] = []
    for table, column, decl in ADDED_COLUMNS:
        existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if not existing:
            continue  # table does not exist yet; schema.sql will have created it
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
            added.append(f"{table}.{column}")
    return added


def schema_fingerprint() -> int:
    """A small integer identifying "the schema this build expects".

    It mixes `SCHEMA_VERSION` with a digest of the editable-field registry, so that
    adding a field to `fields.FIELDS` automatically invalidates the stored schema and
    triggers a view rebuild. That is what keeps "add another editable field" a
    one-line change with no migration bookkeeping to remember.

    Stored in `PRAGMA user_version`, which is a single integer read with no table
    lookup — cheap enough to check on every connection open.
    """
    registry = ";".join(
        f"{f.name}:{f.type}:{f.base_column or ''}" for f in fields_mod.FIELDS
    )
    digest = int(hashlib.sha256(registry.encode()).hexdigest()[:6], 16) % 100_000
    return SCHEMA_VERSION * 100_000 + digest


def migrate(conn: sqlite3.Connection, schema_path: Path | None = None) -> int:
    """Apply the schema. Idempotent, and safe to run against a v1 database.

    Three steps, in order:
      1. `schema.sql` — every statement is CREATE ... IF NOT EXISTS, so this both
         builds a fresh database and adds v2's new tables to an existing one.
      2. ALTER TABLE for columns added to tables that already existed (GPS on
         `activity_samples`) — CREATE IF NOT EXISTS cannot do that.
      3. Rebuild the edit-resolved views from the `fields` registry, so they always
         match the code rather than whatever shape they were first created in.

    A database already stamped with the current fingerprint is left completely
    alone: the API opens a connection per request, and re-running the DDL script
    (and re-creating the views) on each one is both wasted work and a write-lock
    race between concurrent requests.

    Returns the schema version now in force.
    """
    want = schema_fingerprint()
    if int(conn.execute("PRAGMA user_version").fetchone()[0] or 0) == want:
        return SCHEMA_VERSION

    schema_path = schema_path or (Path(__file__).resolve().parent / "schema.sql")
    conn.executescript(schema_path.read_text())
    _add_missing_columns(conn)
    fields_mod.rebuild_views(conn)
    row = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
    current = None if row is None else row["v"]
    if current is None or int(current) < SCHEMA_VERSION:
        conn.execute(
            "INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) "
            "VALUES (?, ?, ?)",
            (SCHEMA_VERSION, "v2: gps, overrides, gear, routes, app state", utcnow()),
        )
    conn.execute(f"PRAGMA user_version = {want}")
    conn.commit()
    return SCHEMA_VERSION


def content_hash(payload: Any) -> str:
    """Stable hash of a JSON-serialisable payload."""
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class Store:
    """Thin wrapper over a sqlite3 connection with the upserts this app needs."""

    def __init__(self, conn: sqlite3.Connection, settings: Settings | None = None):
        self.conn = conn
        self.settings = settings or load_settings()

    # -- lifecycle ---------------------------------------------------------------

    @classmethod
    def open(cls, settings: Settings | None = None) -> "Store":
        settings = settings or load_settings()
        settings.ensure_dirs()
        conn = connect(settings.db_path)
        migrate(conn, settings.schema_path)
        return cls(conn, settings)

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        try:
            yield self.conn
        except Exception:
            self.conn.rollback()
            raise
        else:
            self.conn.commit()

    # -- raw archive -------------------------------------------------------------

    def store_raw(
        self,
        source: str,
        endpoint: str,
        ref_key: str,
        payload: Any,
        fetched_at: str | None = None,
    ) -> int:
        """Archive a payload verbatim. Returns the raw_documents id.

        Storing the same payload twice is a no-op that returns the existing id —
        that is what makes overlapping re-syncs cheap and non-duplicating.
        """
        digest = content_hash(payload)
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        cur = self.conn.execute(
            """
            INSERT INTO raw_documents (source, endpoint, ref_key, fetched_at, content_hash, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (source, endpoint, ref_key, content_hash) DO NOTHING
            """,
            (source, endpoint, ref_key, fetched_at or utcnow(), digest, blob),
        )
        if cur.lastrowid and cur.rowcount:
            return int(cur.lastrowid)
        row = self.conn.execute(
            """
            SELECT id FROM raw_documents
            WHERE source = ? AND endpoint = ? AND ref_key = ? AND content_hash = ?
            """,
            (source, endpoint, ref_key, digest),
        ).fetchone()
        return int(row["id"])

    def raw_documents(self, endpoint: str | None = None) -> list[sqlite3.Row]:
        if endpoint:
            return list(
                self.conn.execute(
                    "SELECT * FROM raw_documents WHERE endpoint = ? ORDER BY id", (endpoint,)
                )
            )
        return list(self.conn.execute("SELECT * FROM raw_documents ORDER BY id"))

    # -- generic upsert ----------------------------------------------------------

    def upsert(self, table: str, keys: Sequence[str], row: Mapping[str, Any]) -> None:
        """INSERT ... ON CONFLICT(keys) DO UPDATE for the non-key columns.

        `row` keys must be real column names; callers build them, not users.
        """
        cols = list(row.keys())
        placeholders = ", ".join("?" for _ in cols)
        updates = [c for c in cols if c not in keys]
        sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})"
        if updates:
            assignments = ", ".join(f"{c} = excluded.{c}" for c in updates)
            sql += f" ON CONFLICT ({', '.join(keys)}) DO UPDATE SET {assignments}"
        else:
            sql += f" ON CONFLICT ({', '.join(keys)}) DO NOTHING"
        self.conn.execute(sql, [row[c] for c in cols])

    def upsert_many(
        self, table: str, keys: Sequence[str], rows: Iterable[Mapping[str, Any]]
    ) -> int:
        n = 0
        for row in rows:
            self.upsert(table, keys, row)
            n += 1
        return n

    # -- watermarks --------------------------------------------------------------

    def get_watermark(self, endpoint: str) -> str | None:
        row = self.conn.execute(
            "SELECT last_day FROM sync_watermark WHERE endpoint = ?", (endpoint,)
        ).fetchone()
        return row["last_day"] if row else None

    def set_watermark(
        self, endpoint: str, last_day: str | None, status: str = "ok", note: str | None = None
    ) -> None:
        self.upsert(
            "sync_watermark",
            ["endpoint"],
            {
                "endpoint": endpoint,
                "last_day": last_day,
                "last_run_at": utcnow(),
                "status": status,
                "note": note,
            },
        )

    def watermarks(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM sync_watermark ORDER BY endpoint")]

    # -- key/value settings ------------------------------------------------------

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = self.conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str | None) -> None:
        self.upsert("app_settings", ["key"], {"key": key, "value": value, "updated_at": utcnow()})
        self.conn.commit()

    # -- sync progress -----------------------------------------------------------

    def sync_status(self, job: str = "backfill") -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM sync_status WHERE job = ?", (job,)).fetchone()
        return dict(row) if row else None

    def set_sync_status(self, job: str, **cols: Any) -> None:
        """Checkpoint a job's progress. Called after every activity during a backfill."""
        cols.setdefault("updated_at", utcnow())
        self.upsert("sync_status", ["job"], {"job": job, **cols})
        self.conn.commit()

    # -- reads -------------------------------------------------------------------

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        return [dict(r) for r in self.conn.execute(sql, params)]

    def scalar(self, sql: str, params: Sequence[Any] = ()) -> Any:
        row = self.conn.execute(sql, params).fetchone()
        return None if row is None else row[0]

    def table_counts(self) -> dict[str, int]:
        tables = [
            r["name"]
            for r in self.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {t: int(self.scalar(f"SELECT COUNT(*) FROM {t}") or 0) for t in sorted(tables)}

    def day_range(self) -> tuple[str | None, str | None]:
        row = self.conn.execute(
            "SELECT MIN(day) AS lo, MAX(day) AS hi FROM daily_wellness"
        ).fetchone()
        return (row["lo"], row["hi"]) if row else (None, None)
