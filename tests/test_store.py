"""Storage layer: migrations, the raw archive, upserts and watermarks.

The non-negotiables being checked here are idempotency (re-running an overlapping
sync must not duplicate anything) and raw-first archival (nothing is discarded).
"""

from __future__ import annotations

import json

import pytest

from garmin_analytics.db import store as S


class TestMigrations:
    def test_migrate_is_idempotent(self, settings):
        conn = S.connect(settings.db_path)
        assert S.migrate(conn, settings.schema_path) == S.SCHEMA_VERSION
        assert S.migrate(conn, settings.schema_path) == S.SCHEMA_VERSION
        rows = conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0]
        assert rows == 1
        conn.close()

    def test_an_existing_database_gains_the_plan_tables_in_place(self, settings):
        """v3 adds tables and nothing else, so an upgrade must keep every row.

        The stamp is cleared rather than the schema rolled back: `migrate` skips
        entirely when the fingerprint already matches, so that is what a database
        written by an older build looks like from here.
        """
        conn = S.connect(settings.db_path)
        S.migrate(conn, settings.schema_path)
        conn.execute(
            "INSERT INTO activities (activity_id, day, start_time_local, activity_type) "
            "VALUES ('keep-me', '2026-10-30', '2026-10-30T05:00:00', 'running')"
        )
        conn.execute("DROP TABLE plan_sessions")
        conn.execute("DROP TABLE plan_links")
        conn.execute("DROP TABLE plan_sources")
        conn.execute("PRAGMA user_version = 0")
        conn.commit()

        assert S.migrate(conn, settings.schema_path) == S.SCHEMA_VERSION
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )}
        assert {"plan_sources", "plan_sessions", "plan_links"} <= tables
        assert conn.execute(
            "SELECT COUNT(*) FROM activities WHERE activity_id = 'keep-me'"
        ).fetchone()[0] == 1
        conn.close()

    def test_garmins_no_reading_marker_never_reaches_a_chart(self, store):
        """Garmin stores -1 as the stress average on a day it measured none. Read as a
        value it is a flat line at the bottom of the chart and a lowered baseline."""
        for day, stress in (("2026-07-23", -1.0), ("2026-07-24", 31.0)):
            store.conn.execute(
                "INSERT INTO daily_wellness (day, stress_avg) VALUES (?, ?)", (day, stress)
            )
        store.conn.commit()

        rows = dict(store.conn.execute("SELECT day, stress_avg FROM v_daily").fetchall())
        assert rows == {"2026-07-23": None, "2026-07-24": 31.0}

    def test_an_existing_database_gets_the_corrected_view(self, settings):
        """The view script is CREATE IF NOT EXISTS in spirit, so a database that already
        has the old v_daily would keep it unless the migration replaces it."""
        conn = S.connect(settings.db_path)
        S.migrate(conn, settings.schema_path)
        conn.execute("DROP VIEW v_daily")
        conn.execute("CREATE VIEW v_daily AS SELECT day, stress_avg FROM daily_wellness")
        conn.execute("INSERT INTO daily_wellness (day, stress_avg) VALUES ('2026-07-23', -1)")
        conn.execute("PRAGMA user_version = 0")
        conn.commit()

        S.migrate(conn, settings.schema_path)

        assert conn.execute("SELECT stress_avg FROM v_daily").fetchone()[0] is None
        conn.close()

    def test_every_expected_table_exists(self, store):
        counts = store.table_counts()
        for table in ("raw_documents", "sync_watermark", "activities", "activity_hr_zones",
                      "activity_samples", "best_efforts", "sleep", "daily_wellness",
                      "hrv_daily", "fitness", "body_composition",
                      "plan_sources", "plan_sessions", "plan_links"):
            assert table in counts

    def test_v_daily_view_exists_and_is_queryable(self, store):
        assert store.query("SELECT * FROM v_daily") == []

    def test_foreign_keys_are_enforced(self, store):
        import sqlite3

        with pytest.raises(sqlite3.IntegrityError):
            store.conn.execute(
                "INSERT INTO activity_hr_zones (activity_id, zone, seconds) VALUES (?, ?, ?)",
                ("does-not-exist", 1, 60),
            )


class TestPlanTables:
    """The two constraints the adherence maths leans on, and the one that keeps history."""

    @staticmethod
    def _source(store) -> int:
        store.conn.execute(
            "INSERT INTO plan_sources (kind, url, label) VALUES ('ics', 'https://x/basic.ics', 'Training')"
        )
        return int(store.scalar("SELECT id FROM plan_sources"))

    @staticmethod
    def _session(store, source_id: int, uid: str, rid: str, day: str) -> int:
        store.conn.execute(
            "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, parse_status) "
            "VALUES (?, ?, ?, ?, 'ok')",
            (source_id, uid, rid, day),
        )
        return int(store.scalar("SELECT MAX(id) FROM plan_sessions"))

    @staticmethod
    def _activity(store, activity_id: str, day: str) -> None:
        store.conn.execute(
            "INSERT INTO activities (activity_id, day, start_time_local, activity_type) "
            "VALUES (?, ?, ?, 'running')",
            (activity_id, day, f"{day}T05:00:00"),
        )

    def test_one_instance_per_recurrence_not_per_series(self, store):
        """A weekly series carries a different prescription each week, so the identity
        has to include the instance. Keyed on `uid` alone, week 2 would overwrite week 1."""
        src = self._source(store)
        self._session(store, src, "dbrc-friday", "2026-10-30", "2026-10-30")
        self._session(store, src, "dbrc-friday", "2026-11-06", "2026-11-06")
        assert store.scalar("SELECT COUNT(*) FROM plan_sessions") == 2

    def test_the_same_instance_cannot_be_stored_twice(self, store):
        import sqlite3

        src = self._source(store)
        self._session(store, src, "dbrc-friday", "2026-10-30", "2026-10-30")
        with pytest.raises(sqlite3.IntegrityError):
            self._session(store, src, "dbrc-friday", "2026-10-30", "2026-10-30")

    def test_one_activity_cannot_fulfil_two_sessions(self, store):
        """Without this, a single long run satisfies both Thursday and Friday and the
        adherence number is one nobody earned."""
        import sqlite3

        src = self._source(store)
        thursday = self._session(store, src, "gym", "2026-10-29", "2026-10-29")
        friday = self._session(store, src, "long", "2026-10-30", "2026-10-30")
        self._activity(store, "act-1", "2026-10-30")
        store.conn.execute(
            "INSERT INTO plan_links (plan_session_id, activity_id, link_type, linked_at) "
            "VALUES (?, 'act-1', 'auto', '2026-10-30T06:00:00Z')",
            (friday,),
        )
        with pytest.raises(sqlite3.IntegrityError):
            store.conn.execute(
                "INSERT INTO plan_links (plan_session_id, activity_id, link_type, linked_at) "
                "VALUES (?, 'act-1', 'auto', '2026-10-30T06:00:00Z')",
                (thursday,),
            )

    def test_a_missed_session_can_be_recorded_without_an_activity(self, store):
        """`ignored` and `missed` have no activity. The uniqueness is partial for that
        reason: several sessions may hold a NULL activity at once."""
        src = self._source(store)
        a = self._session(store, src, "a", "2026-10-29", "2026-10-29")
        b = self._session(store, src, "b", "2026-10-30", "2026-10-30")
        for sid in (a, b):
            store.conn.execute(
                "INSERT INTO plan_links (plan_session_id, activity_id, link_type, linked_at) "
                "VALUES (?, NULL, 'ignored', '2026-10-30T06:00:00Z')",
                (sid,),
            )
        assert store.scalar("SELECT COUNT(*) FROM plan_links") == 2

    def test_unsubscribing_orphans_the_sessions_rather_than_deleting_them(self, store):
        """`ON DELETE CASCADE` here would delete the history this table exists to keep.
        Found by T35's test, which dropped a calendar and lost three finished weeks."""
        src = self._source(store)
        self._session(store, src, "a", "2026-10-30", "2026-10-30")
        store.conn.execute("DELETE FROM plan_sources WHERE id = ?", (src,))
        row = store.query("SELECT source_id, day FROM plan_sessions")[0]
        assert row["source_id"] is None
        assert row["day"] == "2026-10-30"

    def test_a_withdrawn_session_survives_its_source_row(self, store):
        """A series deleted in the calendar takes its past instances with it. The row
        stays, stamped, so a finished week is still judged against what it prescribed."""
        src = self._source(store)
        sid = self._session(store, src, "saturday-club-run", "2026-09-12", "2026-09-12")
        store.conn.execute(
            "UPDATE plan_sessions SET withdrawn_at = '2026-09-19T16:00:00Z' WHERE id = ?",
            (sid,),
        )
        row = store.query("SELECT day, withdrawn_at FROM plan_sessions WHERE id = ?", (sid,))[0]
        assert row["day"] == "2026-09-12"
        assert row["withdrawn_at"] == "2026-09-19T16:00:00Z"


class TestRawArchive:
    def test_stores_the_payload_verbatim(self, store):
        payload = {"b": 2, "a": 1, "nested": {"x": [1, 2, 3]}, "unmodelled_field": "keep me"}
        rid = store.store_raw("connect", "sleep", "2026-09-20", payload)
        row = store.query("SELECT payload FROM raw_documents WHERE id = ?", (rid,))[0]
        assert json.loads(row["payload"]) == payload

    def test_identical_payload_is_not_stored_twice(self, store):
        payload = {"a": 1}
        first = store.store_raw("connect", "sleep", "2026-09-20", payload)
        second = store.store_raw("connect", "sleep", "2026-09-20", payload)
        assert first == second
        assert store.scalar("SELECT COUNT(*) FROM raw_documents") == 1

    def test_key_order_does_not_defeat_deduplication(self, store):
        """Garmin does not promise key order; hashing must be order-independent."""
        store.store_raw("connect", "sleep", "2026-09-20", {"a": 1, "b": 2})
        store.store_raw("connect", "sleep", "2026-09-20", {"b": 2, "a": 1})
        assert store.scalar("SELECT COUNT(*) FROM raw_documents") == 1

    def test_a_changed_payload_is_stored_as_a_new_revision(self, store):
        """Garmin backfills sleep for a day or two — both versions must be kept."""
        store.store_raw("connect", "sleep", "2026-09-20", {"score": 70})
        store.store_raw("connect", "sleep", "2026-09-20", {"score": 74})
        assert store.scalar("SELECT COUNT(*) FROM raw_documents") == 2

    def test_same_key_from_different_sources_coexist(self, store):
        store.store_raw("connect", "sleep", "2026-09-20", {"a": 1})
        store.store_raw("export_zip", "sleep", "2026-09-20", {"a": 1})
        assert store.scalar("SELECT COUNT(*) FROM raw_documents") == 2

    def test_lists_and_scalars_are_archivable(self, store):
        store.store_raw("connect", "readiness", "2026-09-20", [{"score": 71}])
        store.store_raw("connect", "misc", "x", "a bare string")
        assert store.scalar("SELECT COUNT(*) FROM raw_documents") == 2

    def test_content_hash_is_stable_across_processes(self):
        assert S.content_hash({"a": 1, "b": [1, 2]}) == S.content_hash({"b": [1, 2], "a": 1})
        assert S.content_hash({"a": 1}) != S.content_hash({"a": 2})


class TestUpsert:
    def test_insert_then_update(self, store):
        store.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 70})
        store.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 80})
        rows = store.query("SELECT * FROM sleep")
        assert len(rows) == 1 and rows[0]["sleep_score"] == 80

    def test_partial_update_leaves_other_columns_alone(self, store):
        store.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 70,
                                        "total_sleep_s": 25200})
        store.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 80})
        row = store.query("SELECT * FROM sleep")[0]
        assert row["sleep_score"] == 80
        assert row["total_sleep_s"] == 25200

    def test_composite_key(self, store):
        store.upsert("activities", ["activity_id"], {
            "activity_id": "a1", "day": "2026-09-20",
            "start_time_local": "2026-09-20T06:00:00", "activity_type": "running",
        })
        store.upsert("activity_hr_zones", ["activity_id", "zone"],
                     {"activity_id": "a1", "zone": 3, "seconds": 600})
        store.upsert("activity_hr_zones", ["activity_id", "zone"],
                     {"activity_id": "a1", "zone": 3, "seconds": 900})
        rows = store.query("SELECT * FROM activity_hr_zones")
        assert len(rows) == 1 and rows[0]["seconds"] == 900

    def test_key_only_row_does_not_error(self, store):
        store.upsert("sync_watermark", ["endpoint"], {"endpoint": "sleep"})
        store.upsert("sync_watermark", ["endpoint"], {"endpoint": "sleep"})
        assert store.scalar("SELECT COUNT(*) FROM sync_watermark") == 1

    def test_upsert_many_counts_rows(self, store):
        n = store.upsert_many("sleep", ["day"], [
            {"day": "2026-09-19", "sleep_score": 70},
            {"day": "2026-09-20", "sleep_score": 72},
        ])
        assert n == 2 and store.scalar("SELECT COUNT(*) FROM sleep") == 2


class TestWatermarks:
    def test_round_trip(self, store):
        assert store.get_watermark("sleep") is None
        store.set_watermark("sleep", "2026-09-20")
        assert store.get_watermark("sleep") == "2026-09-20"

    def test_overwrite_and_status(self, store):
        store.set_watermark("sleep", "2026-09-20", "ok")
        store.set_watermark("sleep", "2026-09-21", "partial", "rate limited")
        marks = {m["endpoint"]: m for m in store.watermarks()}
        assert marks["sleep"]["last_day"] == "2026-09-21"
        assert marks["sleep"]["status"] == "partial"
        assert marks["sleep"]["note"] == "rate limited"

    def test_survives_the_process_that_wrote_it(self, settings):
        """A watermark that only lives until close is worse than none at all.

        It read back correctly inside the same session, so nothing looked wrong — and
        the next sync re-fetched history it already had. The Fitbit sync hit exactly
        this: its `set_watermark` was the last statement before the store closed.
        """
        with S.Store.open(settings) as writer:
            writer.set_watermark("fitbit_body", "2026-09-24", "ok", "413 weigh-in(s)")

        with S.Store.open(settings) as reader:
            assert reader.get_watermark("fitbit_body") == "2026-09-24"


class TestClosingAStore:
    def test_a_trailing_write_is_committed(self, settings):
        """`__exit__` used to close without committing, silently dropping the tail."""
        with S.Store.open(settings) as writer:
            writer.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 70})

        with S.Store.open(settings) as reader:
            assert reader.scalar("SELECT COUNT(*) FROM sleep") == 1

    def test_a_failed_block_keeps_nothing(self, settings):
        with pytest.raises(RuntimeError):
            with S.Store.open(settings) as writer:
                writer.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 70})
                raise RuntimeError("boom")

        with S.Store.open(settings) as reader:
            assert reader.scalar("SELECT COUNT(*) FROM sleep") == 0


class TestTransactions:
    def test_rollback_on_error(self, store):
        with pytest.raises(RuntimeError):
            with store.tx():
                store.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 70})
                raise RuntimeError("boom")
        assert store.scalar("SELECT COUNT(*) FROM sleep") == 0

    def test_commit_on_success(self, store):
        with store.tx():
            store.upsert("sleep", ["day"], {"day": "2026-09-20", "sleep_score": 70})
        assert store.scalar("SELECT COUNT(*) FROM sleep") == 1


class TestHelpers:
    def test_day_range_on_an_empty_store(self, store):
        assert store.day_range() == (None, None)

    def test_day_range_after_writes(self, store):
        for d in ("2026-09-18", "2026-09-20", "2026-09-19"):
            store.upsert("daily_wellness", ["day"], {"day": d, "steps": 1000})
        assert store.day_range() == ("2026-09-18", "2026-09-20")

    def test_scalar_returns_none_for_no_rows(self, store):
        assert store.scalar("SELECT day FROM sleep LIMIT 1") is None
