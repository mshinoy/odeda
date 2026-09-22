"""Gear: CRUD, assignment semantics, bulk reassign, defaults and mileage maths.

The mileage numbers here are hand-derived in the comments rather than pinned to
whatever the code happened to return, because "the shoes say 812 km" is a claim the
user will act on (they buy new shoes).
"""

from __future__ import annotations

import pytest

from garmin_analytics.edits import gear as G
from garmin_analytics.edits import overrides as ov


def _act(store, activity_id, day, activity_type="running", distance_m=10_000.0,
         moving_time_s=3_000.0):
    store.upsert("activities", ["activity_id"], {
        "activity_id": activity_id,
        "day": day,
        "start_time_local": f"{day}T06:30:00",
        "activity_type": activity_type,
        "activity_name": "Run",
        "distance_m": distance_m,
        "duration_s": moving_time_s,
        "moving_time_s": moving_time_s,
        "elevation_gain_m": 10.0,
    })
    store.conn.commit()
    return activity_id


class TestCrud:
    def test_create_requires_some_identity(self, store):
        with pytest.raises(G.GearError):
            G.create(store, kind="shoe")

    def test_create_rejects_an_unknown_kind(self, store):
        with pytest.raises(G.GearError):
            G.create(store, kind="spaceship", nickname="x")

    def test_display_name_prefers_the_nickname(self, store):
        g = G.create(store, kind="shoe", brand="Asics", model="Novablast 4",
                     nickname="Novablasts")
        assert g["display_name"] == "Novablasts"

    def test_display_name_falls_back_to_brand_and_model(self, store):
        g = G.create(store, kind="shoe", brand="Asics", model="Novablast 4")
        assert g["display_name"] == "Asics Novablast 4"

    def test_update_changes_only_what_was_passed(self, store):
        g = G.create(store, kind="shoe", brand="Asics", nickname="Novablasts")
        out = G.update(store, g["gear_id"], nickname="NBs")
        assert out["nickname"] == "NBs"
        assert out["brand"] == "Asics"

    def test_bad_purchase_date_is_rejected(self, store):
        with pytest.raises(G.GearError):
            G.create(store, kind="shoe", nickname="x", purchase_date="last tuesday")

    def test_retire_and_unretire(self, store):
        g = G.create(store, kind="shoe", nickname="x")
        assert G.retire(store, g["gear_id"])["retired"] == 1
        assert G.retire(store, g["gear_id"], False)["retired"] == 0

    def test_delete_removes_assignments_but_not_activities(self, store):
        a = _act(store, "a1", "2026-01-01")
        g = G.create(store, kind="shoe", nickname="x")
        G.assign(store, a, g["gear_id"])
        assert G.delete(store, g["gear_id"]) is True
        assert store.scalar("SELECT COUNT(*) FROM activity_gear") == 0
        assert store.scalar("SELECT COUNT(*) FROM activities") == 1


class TestMileage:
    def test_total_is_initial_offset_plus_tracked(self, store):
        # Two 10 km runs = 20 000 m tracked, plus a 150 000 m offset = 170 000 m.
        _act(store, "a1", "2026-01-01")
        _act(store, "a2", "2026-01-08")
        g = G.create(store, kind="shoe", nickname="x", initial_distance_m=150_000)
        G.assign(store, "a1", g["gear_id"])
        G.assign(store, "a2", g["gear_id"])
        m = G.get(store, g["gear_id"])
        assert m["tracked_distance_m"] == pytest.approx(20_000.0)
        assert m["total_distance_m"] == pytest.approx(170_000.0)
        assert m["total_distance_km"] == pytest.approx(170.0)
        assert m["activity_count"] == 2

    def test_retirement_percentage(self, store):
        # 400 km on an 800 km threshold = 50 %, 400 km remaining.
        _act(store, "a1", "2026-01-01", distance_m=400_000.0)
        g = G.create(store, kind="shoe", nickname="x", retirement_distance_m=800_000)
        G.assign(store, "a1", g["gear_id"])
        m = G.get(store, g["gear_id"])
        assert m["retirement_pct"] == pytest.approx(50.0)
        assert m["remaining_m"] == pytest.approx(400_000.0)
        assert m["state"] == "ok"

    def test_warning_state_at_85_percent(self, store):
        _act(store, "a1", "2026-01-01", distance_m=700_000.0)   # 87.5 % of 800 km
        g = G.create(store, kind="shoe", nickname="x", retirement_distance_m=800_000)
        G.assign(store, "a1", g["gear_id"])
        assert G.get(store, g["gear_id"])["state"] == "warn"

    def test_over_threshold_state(self, store):
        _act(store, "a1", "2026-01-01", distance_m=900_000.0)
        g = G.create(store, kind="shoe", nickname="x", retirement_distance_m=800_000)
        G.assign(store, "a1", g["gear_id"])
        m = G.get(store, g["gear_id"])
        assert m["state"] == "over"
        assert m["remaining_m"] < 0

    def test_no_threshold_means_no_percentage(self, store):
        _act(store, "a1", "2026-01-01")
        g = G.create(store, kind="shoe", nickname="x")
        G.assign(store, "a1", g["gear_id"])
        m = G.get(store, g["gear_id"])
        assert m["retirement_pct"] is None
        assert m["state"] == "ok"

    def test_excluded_activities_do_not_add_mileage(self, store):
        """The watch left running in the car must not wear out the shoes."""
        _act(store, "a1", "2026-01-01")
        _act(store, "a2", "2026-01-02", distance_m=90_000.0)
        g = G.create(store, kind="shoe", nickname="x")
        G.assign(store, "a1", g["gear_id"])
        G.assign(store, "a2", g["gear_id"])
        assert G.get(store, g["gear_id"])["total_distance_m"] == pytest.approx(100_000.0)

        ov.set_override(store, "a2", "excluded_from_stats", True)
        m = G.get(store, g["gear_id"])
        assert m["total_distance_m"] == pytest.approx(10_000.0)
        assert m["activity_count"] == 1

    def test_distance_per_week(self, store):
        # 2026-01-01 to 2026-01-15 inclusive is 15 days = 2.142857 weeks.
        # 30 km over that span = 14.0 km/week.
        _act(store, "a1", "2026-01-01", distance_m=15_000.0)
        _act(store, "a2", "2026-01-15", distance_m=15_000.0)
        g = G.create(store, kind="shoe", nickname="x")
        G.assign(store, "a1", g["gear_id"])
        G.assign(store, "a2", g["gear_id"])
        m = G.get(store, g["gear_id"])
        assert m["first_use"] == "2026-01-01"
        assert m["last_use"] == "2026-01-15"
        assert m["distance_per_week_km"] == pytest.approx(30.0 / (15 / 7.0), rel=1e-3)


class TestAssignment:
    def test_assigning_shoes_replaces_the_previous_shoes(self, store):
        a = _act(store, "a1", "2026-01-01")
        old = G.create(store, kind="shoe", nickname="old")
        new = G.create(store, kind="shoe", nickname="new")
        G.assign(store, a, old["gear_id"])
        G.assign(store, a, new["gear_id"])
        names = [g["nickname"] for g in G.for_activity(store, a)]
        assert names == ["new"]

    def test_assigning_a_bike_leaves_the_hr_strap_alone(self, store):
        a = _act(store, "a1", "2026-01-01", activity_type="cycling")
        bike = G.create(store, kind="bike", nickname="road")
        strap = G.create(store, kind="strap", nickname="hrm")
        G.assign(store, a, bike["gear_id"])
        G.assign(store, a, strap["gear_id"])
        assert {g["nickname"] for g in G.for_activity(store, a)} == {"road", "hrm"}

    def test_set_for_activity_replaces_the_whole_set(self, store):
        a = _act(store, "a1", "2026-01-01")
        one = G.create(store, kind="shoe", nickname="one")
        two = G.create(store, kind="strap", nickname="two")
        G.assign(store, a, one["gear_id"])
        G.assign(store, a, two["gear_id"])
        G.set_for_activity(store, a, [two["gear_id"]])
        assert [g["nickname"] for g in G.for_activity(store, a)] == ["two"]

    def test_unassign(self, store):
        a = _act(store, "a1", "2026-01-01")
        g = G.create(store, kind="shoe", nickname="x")
        G.assign(store, a, g["gear_id"])
        assert G.unassign(store, a, g["gear_id"]) is True
        assert G.for_activity(store, a) == []

    def test_assigning_to_a_missing_activity_is_an_error(self, store):
        g = G.create(store, kind="shoe", nickname="x")
        with pytest.raises(LookupError):
            G.assign(store, "ghost", g["gear_id"])

    def test_retroactive_assignment_is_just_assignment(self, store):
        """A four-year-old run can be given shoes today; there is no time window."""
        a = _act(store, "old", "2021-02-02")
        g = G.create(store, kind="shoe", nickname="x", purchase_date="2026-01-01")
        G.assign(store, a, g["gear_id"])
        assert G.get(store, g["gear_id"])["activity_count"] == 1


class TestBulk:
    @pytest.fixture
    def history(self, store):
        for i, day in enumerate(["2023-03-01", "2023-06-01", "2023-11-14",
                                 "2024-02-02", "2024-08-08"]):
            _act(store, f"r{i}", day)
        _act(store, "bike1", "2023-07-01", activity_type="cycling", distance_m=40_000.0)
        return store

    def test_dry_run_counts_without_writing(self, history, store):
        g = G.create(store, kind="shoe", nickname="Novablasts")
        out = G.bulk_assign(store, g["gear_id"], start="2023-03-01", end="2023-11-14",
                            activity_type="running", dry_run=True)
        assert out["matched"] == 3
        assert out["applied"] == 0
        assert store.scalar("SELECT COUNT(*) FROM activity_gear") == 0

    def test_date_range_and_type_are_both_applied(self, history, store):
        g = G.create(store, kind="shoe", nickname="Novablasts")
        out = G.bulk_assign(store, g["gear_id"], start="2023-03-01", end="2023-11-14",
                            activity_type="running")
        assert out["applied"] == 3
        assert G.get(store, g["gear_id"])["activity_count"] == 3

    def test_bulk_without_filters_hits_everything(self, history, store):
        g = G.create(store, kind="strap", nickname="hrm")
        assert G.bulk_assign(store, g["gear_id"])["applied"] == 6

    def test_only_unassigned_skips_activities_that_already_have_that_kind(
        self, history, store
    ):
        first = G.create(store, kind="shoe", nickname="first")
        second = G.create(store, kind="shoe", nickname="second")
        G.assign(store, "r0", first["gear_id"])
        out = G.bulk_assign(store, second["gear_id"], activity_type="running",
                            only_unassigned=True)
        assert out["applied"] == 4                       # r1..r4, not r0
        assert G.for_activity(store, "r0")[0]["nickname"] == "first"

    def test_bulk_on_missing_gear_is_an_error(self, store):
        with pytest.raises(LookupError):
            G.bulk_assign(store, 9999)


class TestDefaults:
    def test_default_applies_to_new_activities_only(self, store):
        existing = _act(store, "old", "2026-01-01")
        g = G.create(store, kind="shoe", nickname="current")
        G.set_default(store, "running", g["gear_id"])

        # The rule exists but has not touched the activity that predates it.
        assert G.for_activity(store, existing) == []

        fresh = _act(store, "new", "2026-02-01")
        assert G.apply_defaults(store, [fresh]) == 1
        assert G.for_activity(store, fresh)[0]["nickname"] == "current"

    def test_applying_defaults_never_overwrites_an_existing_choice(self, store):
        a = _act(store, "a1", "2026-02-01")
        chosen = G.create(store, kind="shoe", nickname="chosen")
        default = G.create(store, kind="shoe", nickname="default")
        G.set_default(store, "running", default["gear_id"])
        G.assign(store, a, chosen["gear_id"])
        assert G.apply_defaults(store, [a]) == 0
        assert G.for_activity(store, a)[0]["nickname"] == "chosen"

    def test_new_default_shoes_replace_old_default_shoes_not_the_strap(self, store):
        shoe1 = G.create(store, kind="shoe", nickname="s1")
        shoe2 = G.create(store, kind="shoe", nickname="s2")
        strap = G.create(store, kind="strap", nickname="hrm")
        G.set_default(store, "running", shoe1["gear_id"])
        G.set_default(store, "running", strap["gear_id"])
        G.set_default(store, "running", shoe2["gear_id"])
        names = {d["nickname"] for d in G.list_defaults(store)}
        assert names == {"s2", "hrm"}

    def test_retired_gear_is_not_applied_as_a_default(self, store):
        g = G.create(store, kind="shoe", nickname="worn out")
        G.set_default(store, "running", g["gear_id"])
        G.retire(store, g["gear_id"])
        a = _act(store, "a1", "2026-02-01")
        assert G.apply_defaults(store, [a]) == 0


class TestGarminImport:
    def test_import_creates_gear_keyed_on_uuid(self, store):
        payload = [{
            "uuid": "abc-123",
            "gearMakeName": "Asics",
            "gearModelName": "Novablast 4",
            "customMakeModel": "Novablasts",
            "gearTypeName": "Running Shoes",
            "dateBegin": "2025-06-01",
            "maximumMeters": 800000,
        }]
        out = G.import_from_garmin(store, payload)
        assert out["created"] == 1
        item = G.list_gear(store)[0]
        assert item["kind"] == "shoe"
        assert item["garmin_uuid"] == "abc-123"

    def test_reimport_does_not_duplicate(self, store):
        payload = [{"uuid": "abc-123", "gearMakeName": "Asics",
                    "gearTypeName": "Running Shoes"}]
        G.import_from_garmin(store, payload)
        G.import_from_garmin(store, payload)
        assert len(G.list_gear(store)) == 1

    def test_import_does_not_overwrite_a_user_edit(self, store):
        payload = [{"uuid": "abc-123", "gearMakeName": "Asics",
                    "customMakeModel": "Garmin's name", "gearTypeName": "Running Shoes"}]
        G.import_from_garmin(store, payload)
        item = G.list_gear(store)[0]
        G.update(store, item["gear_id"], nickname="What I call them")
        G.import_from_garmin(store, payload)
        assert G.get(store, item["gear_id"])["nickname"] == "What I call them"
