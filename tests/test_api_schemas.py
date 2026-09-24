"""The typed endpoints: OpenAPI shape, and "typing changed nothing it did not mean to".

The response models in `api/schemas.py` are allowed to do exactly two things to the
JSON: drop the keys we removed on purpose, and nothing else. These tests rebuild the
pre-typing payload from the same underlying functions the old handlers called and
compare, type-strictly (so a 12 turning into 12.0 would fail too).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from garmin_analytics.analytics import performance as perf
from garmin_analytics.analytics import routes as routes_mod
from garmin_analytics.api import schemas
from garmin_analytics.api.server import _splits, create_app
from garmin_analytics.db import fields as fields_mod
from garmin_analytics.db.store import Store
from garmin_analytics.edits import gear as gear_mod
from garmin_analytics.edits import overrides as ov_mod

#: Keys removed from each payload deliberately. Anything else going missing is a bug.
DROPPED_DETAIL_KEYS = {"samples"}
DROPPED_BEST_EFFORT_KEYS = {"time", "pace"}
DROPPED_KM_SPLIT_KEYS = {"pace"}
#: Keys added to every activity row on purpose (T15), read from the raw payload.
ADDED_ROW_KEYS = ["total_sets", "total_reps"]


@pytest.fixture
def rw_settings(seeded_db, settings):
    """A private, writable copy of the seeded database (the shared one is read-only)."""
    settings.ensure_dirs()
    src = sqlite3.connect(seeded_db.db_path)
    dst = sqlite3.connect(settings.db_path)
    src.backup(dst)
    src.close()
    dst.close()
    return settings


@pytest.fixture
def rw_client(rw_settings):
    return TestClient(create_app(rw_settings))


@pytest.fixture
def rw_store(rw_settings):
    st = Store.open(rw_settings)
    yield st
    st.close()


def _strict_equal(a: Any, b: Any, path: str = "$") -> None:
    """Assert equal *and* same JSON types all the way down (1 != 1.0 != True)."""
    assert type(a) is type(b), f"{path}: {type(a).__name__} {a!r} vs {type(b).__name__} {b!r}"
    if isinstance(a, dict):
        assert set(a) == set(b), f"{path}: keys differ: {set(a) ^ set(b)}"
        for k in a:
            _strict_equal(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), f"{path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            _strict_equal(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"


def _as_json(value: Any) -> Any:
    return json.loads(json.dumps(value))


def _with_gym_totals(row: dict[str, Any] | None) -> dict[str, Any]:
    """A view row as the API returns it. The seeded payloads carry no exercise data,
    so the totals are null here; tests/test_gym.py covers the filled-in case."""
    assert row is not None
    return {**row, **{k: None for k in ADDED_ROW_KEYS}}


def _old_detail(st: Store, activity_id: str) -> dict[str, Any]:
    """The pre-typing `GET /api/activities/{id}` body (samples=true), verbatim."""
    act = _with_gym_totals(ov_mod.effective(st, activity_id))
    zones = st.query(
        "SELECT zone, seconds FROM activity_hr_zones WHERE activity_id = ? ORDER BY zone",
        (activity_id,),
    )
    bests = st.query(
        "SELECT distance_m, seconds FROM best_efforts WHERE activity_id = ? "
        "ORDER BY distance_m",
        (activity_id,),
    )
    sample_rows = st.query(
        "SELECT elapsed_s, distance_m, hr, speed_mps, cadence_spm, altitude_m, lat, lon "
        "FROM activity_samples WHERE activity_id = ? ORDER BY elapsed_s",
        (activity_id,),
    )
    dec = ef = None
    if sample_rows:
        dec = perf.aerobic_decoupling(
            [float(r["elapsed_s"]) for r in sample_rows],
            [float(r["distance_m"] or 0) for r in sample_rows],
            [r["hr"] for r in sample_rows],
        )
        ef = perf.efficiency_factor(
            float(act["distance_m"] or 0),
            float(act["moving_time_s"] or 0),
            float(act["avg_hr"] or 0),
        )
    return {
        "activity": act,
        "hr_zones": zones,
        "best_efforts": [
            {
                **b,
                "label": perf.DISTANCE_LABELS.get(b["distance_m"]),
                "time": perf.hms(float(b["seconds"])),
                "pace": perf.pace_str(float(b["seconds"]) / (float(b["distance_m"]) / 1000.0)),
            }
            for b in bests
        ],
        "decoupling_pct": None if dec is None else round(dec, 2),
        "efficiency_factor": None if ef is None else round(ef, 3),
        "km_splits": _splits(sample_rows),
        "samples": sample_rows,
        "gear": gear_mod.for_activity(st, activity_id),
        "overrides": ov_mod.list_overrides(st, activity_id),
        "route": routes_mod.activity_track(st, activity_id)["route"],
        "has_gps": any(r.get("lat") is not None for r in sample_rows),
    }


def _minus_dropped(old: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in old.items() if k not in DROPPED_DETAIL_KEYS}
    out["best_efforts"] = [
        {k: v for k, v in b.items() if k not in DROPPED_BEST_EFFORT_KEYS}
        for b in old["best_efforts"]
    ]
    out["km_splits"] = [
        {k: v for k, v in s.items() if k not in DROPPED_KM_SPLIT_KEYS}
        for s in old["km_splits"]
    ]
    return out


def _pick(st: Store, sql: str) -> str:
    row = st.conn.execute(sql).fetchone()
    assert row is not None, sql
    return str(row[0])


@pytest.fixture
def sample_ids(rw_client, rw_store) -> dict[str, str]:
    """A spread of activities, one of them edited so every optional part is filled."""
    ids = {
        # GPS run on a route, with gear and best efforts.
        "gps_run": _pick(rw_store, """
            SELECT a.activity_id FROM activities a
            JOIN route_members rm USING (activity_id)
            JOIN activity_gear ag USING (activity_id)
            JOIN best_efforts be USING (activity_id)
            WHERE a.activity_type = 'running' ORDER BY a.day DESC LIMIT 1"""),
        "treadmill": _pick(rw_store, """
            SELECT activity_id FROM activities WHERE activity_type = 'treadmill_running'
            ORDER BY day DESC LIMIT 1"""),
        "no_samples": _pick(rw_store, """
            SELECT activity_id FROM activities a WHERE NOT EXISTS
            (SELECT 1 FROM activity_samples s WHERE s.activity_id = a.activity_id)
            ORDER BY day DESC LIMIT 1"""),
    }
    res = rw_client.patch(
        f"/api/activities/{ids['gps_run']}",
        json={"activity_name": "Edited", "rpe": 7, "notes": "felt good",
              "private": True, "excluded_from_stats": False},
    )
    assert res.status_code == 200, res.text
    # A manual route move, so match_score is null and assigned is 'manual'.
    other_route = rw_store.scalar(
        "SELECT route_id FROM routes WHERE route_id != "
        "(SELECT route_id FROM route_members WHERE activity_id = ?) LIMIT 1",
        (ids["gps_run"],),
    )
    moved = _pick(rw_store, f"""
        SELECT activity_id FROM route_members WHERE activity_id != '{ids["gps_run"]}'
        LIMIT 1""")
    assert rw_client.put(f"/api/activities/{moved}/route",
                         json={"route_id": other_route}).status_code == 200
    ids["manual_route"] = moved
    return ids


class TestPayloadsUnchangedExceptDrops:
    def test_list_rows_equal_the_view(self, rw_client, rw_store, sample_ids):
        body = rw_client.get("/api/activities?limit=1000").json()
        view = rw_store.query(
            "SELECT * FROM v_activities ORDER BY day DESC, activity_id DESC"
        )
        assert body["total"] == len(view)
        _strict_equal(body["rows"], _as_json([_with_gym_totals(r) for r in view]))
        edited = next(r for r in body["rows"] if r["activity_id"] == sample_ids["gps_run"])
        assert edited["override_count"] == 5 and edited["rpe"] == 7 and edited["private"] == 1
        assert edited["gear_ids"] and edited["route_id"] is not None

    def test_list_envelope(self, rw_client, rw_store):
        body = rw_client.get("/api/activities?limit=5&offset=2").json()
        assert set(body) == {"total", "limit", "offset", "types", "rows"}
        assert (body["limit"], body["offset"]) == (5, 2)
        assert set(body["types"]) == {
            r["activity_type"] for r in rw_store.query("SELECT activity_type FROM v_activities")
        }

    def test_activity_row_declares_every_view_column(self, rw_store):
        cols = [d[0] for d in rw_store.conn.execute(
            "SELECT * FROM v_activities LIMIT 0").description]
        assert list(schemas.ActivityRow.model_fields) == cols + ADDED_ROW_KEYS, (
            "v_activities changed shape: declare the new column on ActivityRow "
            "(an undeclared column is silently left out of the API)"
        )

    @pytest.mark.parametrize("which", ["gps_run", "treadmill", "no_samples", "manual_route"])
    def test_detail_equals_old_minus_dropped_keys(self, rw_client, rw_store, sample_ids,
                                                  which):
        aid = sample_ids[which]
        old = _as_json(_old_detail(rw_store, aid))
        new = rw_client.get(f"/api/activities/{aid}").json()
        _strict_equal(new, _minus_dropped(old))
        # And exactly those keys, no more: the diff is the drop list.
        assert set(old) - set(new) == DROPPED_DETAIL_KEYS

    def test_the_edited_detail_exercises_every_optional_part(self, rw_client, sample_ids):
        d = rw_client.get(f"/api/activities/{sample_ids['gps_run']}").json()
        assert d["gear"] and d["overrides"] and d["route"] and d["best_efforts"]
        assert d["km_splits"] and d["has_gps"] is True
        assert d["route"]["assigned"] == "auto"
        assert {o["field"] for o in d["overrides"]} == {
            "activity_name", "rpe", "notes", "private", "excluded_from_stats"}
        manual = rw_client.get(f"/api/activities/{sample_ids['manual_route']}").json()
        assert manual["route"]["assigned"] == "manual"
        assert manual["route"]["match_score"] is None
        indoor = rw_client.get(f"/api/activities/{sample_ids['treadmill']}").json()
        assert indoor["has_gps"] is False and indoor["route"] is None
        bare = rw_client.get(f"/api/activities/{sample_ids['no_samples']}").json()
        assert bare["km_splits"] == [] and bare["decoupling_pct"] is None
        assert bare["efficiency_factor"] is None


class TestEditAndFields:
    def test_patch_response_matches_the_store(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activities LIMIT 1")
        res = rw_client.patch(f"/api/activities/{aid}",
                              json={"activity_name": "Renamed", "rpe": 4, "private": True,
                                    "notes": ""})
        assert res.status_code == 200, res.text
        body = res.json()
        _strict_equal(body["activity"],
                      _as_json(_with_gym_totals(ov_mod.effective(rw_store, aid))))
        _strict_equal(body["overrides"], _as_json(ov_mod.list_overrides(rw_store, aid)))
        by_field = {a["field"]: a for a in body["applied"]}
        assert by_field["private"]["value"] == 1            # bools are stored as 0/1
        assert by_field["rpe"]["value"] == 4 and by_field["rpe"]["value_type"] == "int"
        assert by_field["activity_name"]["reverted"] is False
        assert set(by_field["activity_name"]) == {
            "activity_id", "field", "value", "value_type", "garmin_value", "updated_at",
            "reverted"}
        # An empty text value reverts; that entry keeps its short shape.
        assert by_field["notes"] == {"activity_id": aid, "field": "notes", "value": None,
                                     "reverted": True}

    def test_patch_rejects_a_non_scalar_value(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activities LIMIT 1")
        assert rw_client.patch(f"/api/activities/{aid}",
                               json={"notes": ["a", "list"]}).status_code == 422

    def test_patch_errors_are_unchanged(self, rw_client):
        assert rw_client.patch("/api/activities/nope", json={"rpe": 3}).status_code == 404
        assert rw_client.patch("/api/activities/nope", json={"bogus": 3}).status_code == 400

    def test_fields(self, rw_client):
        body = rw_client.get("/api/fields").json()
        assert body["activity_types"] == list(fields_mod.ACTIVITY_TYPES)
        old = fields_mod.fields_json()
        assert [set(f) for f in body["fields"]] == [set(f) for f in old]
        assert body["fields"] == old     # 1 == 1.0: min/max are declared as numbers


class TestOpenApi:
    @pytest.fixture
    def app_and_spec(self, rw_settings):
        app = create_app(rw_settings)
        return app, TestClient(app).get("/openapi.json").json()

    def test_operation_ids_are_handler_names(self, app_and_spec):
        app, spec = app_and_spec
        seen = []
        for route in app.routes:
            if not isinstance(route, APIRoute) or not route.include_in_schema:
                continue
            for method in route.methods:
                op = spec["paths"][route.path_format][method.lower()]
                assert op["operationId"] == route.endpoint.__name__
                seen.append(op["operationId"])
        assert seen and len(seen) == len(set(seen))

    def test_models_are_in_components(self, app_and_spec):
        _, spec = app_and_spec
        comps = spec["components"]["schemas"]
        for name in ("ActivityRow", "ActivityList", "ActivityDetail", "ActivityStreams",
                     "ActivityEditResult", "AppliedEdit", "RevertedEdit", "Override",
                     "ActivityGear", "RouteAssignment", "HrZone", "BestEffort", "KmSplit",
                     "FieldsResponse", "EditableFieldInfo"):
            assert name in comps, name
        assert set(comps["ActivityRow"]["properties"]) == set(schemas.ActivityRow.model_fields)
        assert "pace" not in comps["KmSplit"]["properties"]
        assert "samples" not in comps["ActivityDetail"]["properties"]

    def test_typed_paths_reference_their_models(self, app_and_spec):
        _, spec = app_and_spec

        def ref(path: str, method: str) -> str:
            schema = spec["paths"][path][method]["responses"]["200"]["content"][
                "application/json"]["schema"]
            return schema["$ref"].rsplit("/", 1)[-1]

        assert ref("/api/activities", "get") == "ActivityList"
        assert ref("/api/activities/{activity_id}", "get") == "ActivityDetail"
        assert ref("/api/activities/{activity_id}/streams", "get") == "ActivityStreams"
        assert ref("/api/activities/{activity_id}", "patch") == "ActivityEditResult"
        assert ref("/api/fields", "get") == "FieldsResponse"
        detail_params = {p["name"] for p in
                         spec["paths"]["/api/activities/{activity_id}"]["get"]["parameters"]}
        assert detail_params == {"activity_id"}
        body = spec["paths"]["/api/activities/{activity_id}"]["patch"]["requestBody"]
        body_schema = body["content"]["application/json"]["schema"]
        assert body_schema["type"] == "object" and "additionalProperties" in body_schema
