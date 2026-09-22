"""The editing layer: the field registry, the generated view, and edit survival.

The load-bearing assertion in this file is `test_override_survives_full_reingest`.
Everything else is detail; that one is the requirement.
"""

from __future__ import annotations

import pytest

from garmin_analytics.db import fields as fields_mod
from garmin_analytics.edits import overrides as ov


def _activity(store, activity_id="a1", **over):
    row = {
        "activity_id": activity_id,
        "day": "2026-03-04",
        "start_time_local": "2026-03-04T06:30:00",
        "activity_type": "walking",
        "activity_name": "Doha Walking",
        "distance_m": 10000.0,
        "duration_s": 3000.0,
        "moving_time_s": 2950.0,
        "avg_hr": 138.0,
        "avg_speed_mps": 10000.0 / 2950.0,
        "elevation_gain_m": 12.0,
        "trimp": 55.0,
    }
    row.update(over)
    store.upsert("activities", ["activity_id"], row)
    store.conn.commit()
    return activity_id


class TestRegistry:
    def test_every_field_has_a_usable_editor(self):
        allowed = {"text", "textarea", "select", "number", "bool"}
        for f in fields_mod.FIELDS:
            assert f.editor in allowed, f"{f.name} has editor {f.editor!r}"
            assert f.type in {"text", "real", "int", "bool"}
            assert f.label, f"{f.name} has no label"

    def test_select_fields_carry_choices(self):
        for f in fields_mod.FIELDS:
            if f.editor == "select":
                assert f.choices, f"{f.name} is a select with no choices"

    def test_bool_coercion_accepts_what_a_browser_sends(self):
        f = fields_mod.FIELDS_BY_NAME["private"]
        for truthy in (True, 1, "1", "true", "TRUE", "yes", "on"):
            assert f.coerce(truthy) == 1, truthy
        for falsy in (False, 0, "0", "false", "no", "off"):
            assert f.coerce(falsy) == 0, falsy

    def test_rpe_bounds_are_enforced(self):
        f = fields_mod.FIELDS_BY_NAME["rpe"]
        assert f.coerce(7) == 7
        for bad in (0, 11, -3):
            with pytest.raises(ValueError):
                f.coerce(bad)

    def test_rpe_rejects_nonsense(self):
        with pytest.raises(ValueError):
            fields_mod.FIELDS_BY_NAME["rpe"].coerce("hard-ish")

    def test_activity_type_choices_are_advisory_not_enforced(self):
        """Garmin invents sports; an unknown type must round-trip, not 400."""
        f = fields_mod.FIELDS_BY_NAME["activity_type"]
        assert f.strict_choices is False
        assert f.coerce("padel") == "padel"

    def test_activity_type_choices_match_what_ingestion_produces(self):
        """A dropdown offering values the data never contains is worse than useless."""
        from garmin_analytics.ingest.normalize import TYPE_MAP

        produced = set(TYPE_MAP.values())
        offered = set(fields_mod.ACTIVITY_TYPES)
        assert produced <= offered, f"ingestion produces {produced - offered}, not offered"

    def test_empty_text_means_revert_not_empty_string(self):
        assert fields_mod.FIELDS_BY_NAME["activity_name"].coerce("   ") is None


class TestView:
    def test_view_exposes_every_activities_column(self, store):
        base = set(fields_mod.activities_columns(store.conn))
        view = {r[1] for r in store.conn.execute("PRAGMA table_info(v_activities)")}
        assert base <= view

    def test_view_exposes_every_user_only_field(self, store):
        view = {r[1] for r in store.conn.execute("PRAGMA table_info(v_activities)")}
        for f in fields_mod.FIELDS:
            assert f.name in view, f"{f.name} missing from v_activities"

    def test_view_is_rebuilt_when_the_registry_changes(self, store):
        """The fingerprint in PRAGMA user_version is what makes this automatic."""
        from garmin_analytics.db.store import migrate, schema_fingerprint

        assert store.conn.execute("PRAGMA user_version").fetchone()[0] == schema_fingerprint()
        store.conn.execute("PRAGMA user_version = 1")
        assert fields_mod.rebuild_views(store.conn) is False  # definition unchanged
        migrate(store.conn)
        assert store.conn.execute("PRAGMA user_version").fetchone()[0] == schema_fingerprint()

    def test_migrate_is_a_no_op_when_current(self, store):
        """Opened per request: re-running the DDL every time is both slow and racy."""
        from garmin_analytics.db.store import migrate

        before = store.conn.execute(
            "SELECT COUNT(*) FROM sqlite_master"
        ).fetchone()[0]
        migrate(store.conn)
        after = store.conn.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()[0]
        assert before == after


class TestOverrides:
    def test_unedited_activity_shows_garmin_values(self, store):
        aid = _activity(store)
        eff = ov.effective(store, aid)
        assert eff["activity_name"] == "Doha Walking"
        assert eff["activity_type"] == "walking"
        assert eff["override_count"] == 0
        assert eff["rpe"] is None

    def test_override_masks_the_garmin_value(self, store):
        aid = _activity(store)
        ov.set_override(store, aid, "activity_name", "Corniche loop")
        ov.set_override(store, aid, "activity_type", "running")
        eff = ov.effective(store, aid)
        assert eff["activity_name"] == "Corniche loop"
        assert eff["activity_type"] == "running"
        # The Garmin table itself is untouched: overrides never write to `activities`.
        raw = store.query("SELECT activity_name FROM activities WHERE activity_id = ?", (aid,))
        assert raw[0]["activity_name"] == "Doha Walking"

    def test_user_only_fields_have_no_garmin_value(self, store):
        aid = _activity(store)
        ov.set_override(store, aid, "notes", "legs felt heavy")
        ov.set_override(store, aid, "rpe", 8)
        eff = ov.effective(store, aid)
        assert eff["notes"] == "legs felt heavy"
        assert eff["rpe"] == 8

    def test_types_come_back_out_as_they_went_in(self, store):
        aid = _activity(store)
        ov.set_override(store, aid, "rpe", "6")
        ov.set_override(store, aid, "private", "true")
        eff = ov.effective(store, aid)
        assert eff["rpe"] == 6 and isinstance(eff["rpe"], int)
        assert eff["private"] == 1

    def test_revert_restores_the_garmin_value(self, store):
        aid = _activity(store)
        ov.set_override(store, aid, "activity_name", "Corniche loop")
        assert ov.revert(store, aid, "activity_name") is True
        assert ov.effective(store, aid)["activity_name"] == "Doha Walking"

    def test_setting_none_is_a_revert(self, store):
        aid = _activity(store)
        ov.set_override(store, aid, "activity_name", "Corniche loop")
        result = ov.set_override(store, aid, "activity_name", "")
        assert result["reverted"] is True
        assert ov.effective(store, aid)["activity_name"] == "Doha Walking"

    def test_first_garmin_value_is_kept_across_repeated_edits(self, store):
        """Revert must offer what Garmin *said*, not the previous edit."""
        aid = _activity(store)
        ov.set_override(store, aid, "activity_name", "first try")
        ov.set_override(store, aid, "activity_name", "second try")
        rows = ov.list_overrides(store, aid)
        assert rows[0]["garmin_value_at_edit"] == "Doha Walking"

    def test_revert_all(self, store):
        aid = _activity(store)
        ov.set_many(store, aid, {"activity_name": "x", "rpe": 4, "notes": "y"})
        assert ov.revert_all(store, aid) == 3
        assert ov.effective(store, aid)["override_count"] == 0

    def test_unknown_field_is_rejected(self, store):
        aid = _activity(store)
        with pytest.raises(ov.UnknownField):
            ov.set_override(store, aid, "vo2max_i_wish", 70)

    def test_editing_a_missing_activity_is_an_error(self, store):
        with pytest.raises(LookupError):
            ov.set_override(store, "nope", "activity_name", "x")

    def test_bulk_set_reports_missing_ids(self, store):
        a = _activity(store, "a1")
        b = _activity(store, "a2")
        out = ov.bulk_set(store, [a, b, "ghost"], "excluded_from_stats", True)
        assert out["applied"] == 2
        assert out["missing"] == ["ghost"]

    def test_excluded_activities_leave_v_activities_included(self, store):
        a = _activity(store, "a1")
        _activity(store, "a2")
        assert store.scalar("SELECT COUNT(*) FROM v_activities_included") == 2
        ov.set_override(store, a, "excluded_from_stats", True)
        assert store.scalar("SELECT COUNT(*) FROM v_activities_included") == 1
        # ...but it is still visible in the activities list.
        assert store.scalar("SELECT COUNT(*) FROM v_activities") == 2

    def test_deleting_an_activity_takes_its_overrides(self, store):
        aid = _activity(store)
        ov.set_override(store, aid, "rpe", 5)
        store.conn.execute("DELETE FROM activities WHERE activity_id = ?", (aid,))
        store.conn.commit()
        assert store.scalar("SELECT COUNT(*) FROM overrides") == 0


class TestSurvivesSync:
    def test_override_survives_a_plain_upsert(self, store):
        """The narrow case: ingestion re-upserts the same activity row."""
        aid = _activity(store)
        ov.set_override(store, aid, "activity_name", "Corniche loop")
        _activity(store, aid, activity_name="Doha Walking (updated by Garmin)")
        assert ov.effective(store, aid)["activity_name"] == "Corniche loop"

    def test_override_survives_full_reingest(self, seeded_store):
        """The real case: re-parse every archived payload, rewriting `activities`.

        This is the same write path a sync takes. If an edit can be clobbered, it
        gets clobbered here.
        """
        from garmin_analytics.edits import gear as gear_mod
        from garmin_analytics.ingest import connect as connect_mod

        st = seeded_store
        aid = st.query(
            "SELECT activity_id FROM v_activities WHERE activity_type = 'running' "
            "ORDER BY day DESC LIMIT 1"
        )[0]["activity_id"]

        ov.set_override(st, aid, "activity_name", "Corniche loop PB attempt")
        ov.set_override(st, aid, "rpe", 9)
        ov.set_override(st, aid, "notes", "held on")
        shoe = gear_mod.create(st, kind="shoe", nickname="Round-trip shoes",
                               retirement_distance_m=800_000)
        gear_mod.assign(st, aid, shoe["gear_id"])
        km_before = gear_mod.get(st, shoe["gear_id"])["total_distance_km"]

        total = st.scalar("SELECT COUNT(*) FROM activities")
        counts = connect_mod.renormalize(st)
        assert counts["activities"] == total, "the re-ingest did not rewrite every activity"

        eff = ov.effective(st, aid)
        assert eff["activity_name"] == "Corniche loop PB attempt"
        assert eff["rpe"] == 9
        assert eff["notes"] == "held on"
        after = gear_mod.get(st, shoe["gear_id"])
        assert after["activity_count"] == 1
        assert after["total_distance_km"] == pytest.approx(km_before)

        # Cleanup: this fixture is session-scoped and shared with read-only tests.
        ov.revert_all(st, aid)
        gear_mod.delete(st, shoe["gear_id"])
