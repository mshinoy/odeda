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

    def test_every_expected_table_exists(self, store):
        counts = store.table_counts()
        for table in ("raw_documents", "sync_watermark", "activities", "activity_hr_zones",
                      "activity_samples", "best_efforts", "sleep", "daily_wellness",
                      "hrv_daily", "fitness", "body_composition"):
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
