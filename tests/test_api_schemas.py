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
#: Columns the view holds raw and the API resolves at the boundary (T07): `race` is
#: the user's override falling back to the payload's eventType, so it is never null.
RESOLVED_ROW_KEYS = ["race"]
#: What only the list sends, for its cards (T33); checked in `test_preview.py`.
LIST_ONLY_ROW_KEYS = ["has_gps", "hr_zones", "exercises"]


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
    so the totals are null here; tests/test_gym.py covers the filled-in case. `race`
    resolves to 0 for the same reason: no seeded payload carries an eventType."""
    assert row is not None
    resolved = {k: int(bool(row[k])) for k in RESOLVED_ROW_KEYS}
    return {**row, **resolved, **{k: None for k in ADDED_ROW_KEYS}}


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
        rows = [{k: v for k, v in r.items() if k not in LIST_ONLY_ROW_KEYS} for r in body["rows"]]
        _strict_equal(rows, _as_json([_with_gym_totals(r) for r in view]))
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
                     "FieldsResponse", "EditableFieldInfo", "GearList", "GearItem",
                     "GearDefaultRule", "ActivityGearResult", "ActivityGearRequest",
                     "RouteList", "RouteSummary", "ActivityRouteResult",
                     "ActivityRouteRequest", "Heatmap"):
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
        assert ref("/api/gear", "get") == "GearList"
        assert ref("/api/routes", "get") == "RouteList"
        assert ref("/api/activities/{activity_id}/gear", "put") == "ActivityGearResult"
        assert ref("/api/activities/{activity_id}/route", "put") == "ActivityRouteResult"
        detail_params = {p["name"] for p in
                         spec["paths"]["/api/activities/{activity_id}"]["get"]["parameters"]}
        assert detail_params == {"activity_id"}
        body = spec["paths"]["/api/activities/{activity_id}"]["patch"]["requestBody"]
        body_schema = body["content"]["application/json"]["schema"]
        assert body_schema["type"] == "object" and "additionalProperties" in body_schema


class TestGearAndRoute:
    """T03c's selects: `GET /api/gear`, `GET /api/routes`, and the two PUTs."""

    def test_gear_list_equals_the_store(self, rw_client, rw_store):
        body = rw_client.get("/api/gear").json()
        _strict_equal(body, _as_json({
            "gear": gear_mod.list_gear(rw_store, True, None),
            "defaults": gear_mod.list_defaults(rw_store),
            "kinds": list(gear_mod.GEAR_KINDS),
        }))
        assert body["gear"], "the seeded database should have gear"

    def test_gear_list_filters(self, rw_client, rw_store):
        shoes = rw_client.get("/api/gear?kind=shoe&include_retired=false").json()["gear"]
        _strict_equal(shoes, _as_json(gear_mod.list_gear(rw_store, False, "shoe")))
        assert {g["kind"] for g in shoes} == {"shoe"}
        assert all(g["retired"] == 0 for g in shoes)

    def test_routes_equal_the_store(self, rw_client, rw_store):
        # `median_moving_time_s` is added at the boundary (T05a); TestRoutes covers it.
        def without_median(rows):
            return [{k: v for k, v in r.items() if k != "median_moving_time_s"} for r in rows]

        _strict_equal(without_median(rw_client.get("/api/routes").json()["routes"]),
                      _as_json(routes_mod.list_routes(rw_store)))
        running = rw_client.get("/api/routes?type=running").json()
        _strict_equal(without_median(running["routes"]),
                      _as_json(routes_mod.list_routes(rw_store, "running")))
        assert running["routes"], "the seeded database should have running routes"

    def test_assigning_one_item_replaces_that_kind_only(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activity_gear LIMIT 1")
        shoe = int(_pick(rw_store, "SELECT gear_id FROM gear WHERE kind = 'shoe' LIMIT 1"))
        strap = int(_pick(rw_store, "SELECT gear_id FROM gear WHERE kind = 'strap' LIMIT 1"))
        rw_client.put(f"/api/activities/{aid}/gear", json={"gear_ids": [shoe, strap]})
        other = int(_pick(
            rw_store, f"SELECT gear_id FROM gear WHERE kind = 'shoe' AND gear_id != {shoe} LIMIT 1"
        ))
        res = rw_client.put(f"/api/activities/{aid}/gear", json={"gear_id": other})
        assert res.status_code == 200, res.text
        body = res.json()
        _strict_equal(body, _as_json(
            {"activity_id": aid, "gear": gear_mod.for_activity(rw_store, aid)}))
        # The other pair of shoes went, the strap stayed.
        assert {g["gear_id"] for g in body["gear"]} == {other, strap}

    def test_setting_the_whole_set_replaces_it(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activity_gear LIMIT 1")
        gid = int(_pick(rw_store, "SELECT gear_id FROM gear LIMIT 1"))
        body = rw_client.put(f"/api/activities/{aid}/gear", json={"gear_ids": [gid]}).json()
        assert [g["gear_id"] for g in body["gear"]] == [gid]
        # And an empty list takes all the gear off.
        cleared = rw_client.put(f"/api/activities/{aid}/gear", json={"gear_ids": []}).json()
        assert cleared["gear"] == []

    def test_gear_errors_are_unchanged(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activities LIMIT 1")
        assert rw_client.put(f"/api/activities/{aid}/gear",
                             json={"gear_id": 999999}).status_code == 404
        assert rw_client.put("/api/activities/nope/gear",
                             json={"gear_id": 1}).status_code == 404
        assert rw_client.put(f"/api/activities/{aid}/gear", json={}).status_code == 400

    def test_moving_an_activity_to_another_route(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM route_members LIMIT 1")
        target = int(_pick(rw_store, (
            "SELECT route_id FROM routes WHERE route_id != "
            f"(SELECT route_id FROM route_members WHERE activity_id = '{aid}') LIMIT 1")))
        res = rw_client.put(f"/api/activities/{aid}/route", json={"route_id": target})
        assert res.status_code == 200, res.text
        assert res.json() == {"activity_id": aid, "route_id": target, "assigned": "manual"}
        detail = rw_client.get(f"/api/activities/{aid}").json()
        assert detail["route"]["route_id"] == target
        assert detail["route"]["assigned"] == "manual"
        assert detail["route"]["match_score"] is None

    def test_route_errors_are_unchanged(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM route_members LIMIT 1")
        assert rw_client.put(f"/api/activities/{aid}/route",
                             json={"route_id": 999999}).status_code == 404


class TestHeatmap:
    """T04's `GET /api/heatmap`: the same grid `analytics/routes` builds, columnar."""

    def test_columns_are_the_stores_points_transposed(self, rw_client, rw_store):
        body = rw_client.get("/api/heatmap").json()
        grid = _as_json(routes_mod.heatmap(rw_store))

        assert body["cells"] > 0, "the seeded database should have GPS points"
        for key in ("precision", "cells", "max_count"):
            _strict_equal(body[key], grid[key], key)
        _strict_equal(
            list(zip(body["lat"], body["lon"], body["count"])),
            [tuple(p) for p in grid["points"]],
            "$.columns",
        )

    def test_every_column_is_as_long_as_the_grid(self, rw_client):
        body = rw_client.get("/api/heatmap").json()
        assert len(body["lat"]) == len(body["lon"]) == len(body["count"]) == body["cells"]
        assert max(body["count"]) == body["max_count"]

    def test_an_empty_grid_is_three_empty_columns(self, rw_client):
        # A day with nothing on it: the transpose has no rows to unzip.
        body = rw_client.get("/api/heatmap?start=1970-01-01&end=1970-01-02").json()
        assert body == {"precision": 4, "cells": 0, "max_count": 0,
                        "lat": [], "lon": [], "count": []}

    def test_filters_and_precision_reach_the_query(self, rw_client, rw_store):
        coarse = rw_client.get("/api/heatmap?precision=2").json()
        fine = rw_client.get("/api/heatmap?precision=5").json()
        # A coarser grid merges cells, so there are fewer of them and each holds more.
        assert coarse["cells"] < fine["cells"]
        assert coarse["max_count"] > fine["max_count"]

        runs = rw_client.get("/api/heatmap?type=running").json()
        assert runs["count"] == [p[2] for p in routes_mod.heatmap(rw_store, "running")["points"]]
        assert 0 < runs["cells"] < rw_client.get("/api/heatmap").json()["cells"]

    def test_precision_is_bounded(self, rw_client):
        # The bound is what keeps `precision` out of the f-string it is interpolated into.
        assert rw_client.get("/api/heatmap?precision=1").status_code == 422
        assert rw_client.get("/api/heatmap?precision=7").status_code == 422

    def test_the_response_is_the_typed_model(self, rw_settings):
        spec = TestClient(create_app(rw_settings)).get("/openapi.json").json()
        ref = spec["paths"]["/api/heatmap"]["get"]["responses"]["200"]["content"][
            "application/json"]["schema"]["$ref"]
        assert ref.rsplit("/", 1)[-1] == "Heatmap"
        props = spec["components"]["schemas"]["Heatmap"]["properties"]
        assert props["count"]["items"]["type"] == "integer"
        assert "points" not in props


class TestRoutes:
    """T05a: every route endpoint typed, and the two shapes the UI reads columnar."""

    @pytest.fixture
    def route_id(self, rw_store):
        return int(_pick(rw_store, (
            "SELECT route_id FROM route_members GROUP BY route_id "
            "ORDER BY COUNT(*) DESC LIMIT 1")))

    def test_list_carries_a_median_beside_the_best(self, rw_client, rw_store):
        rows = rw_client.get("/api/routes").json()["routes"]
        listed = {r["route_id"]: r for r in rows}
        _strict_equal(
            [{k: v for k, v in r.items() if k != "median_moving_time_s"} for r in rows],
            _as_json(routes_mod.list_routes(rw_store)),
        )
        # The median is over the same attempts as best and average, so it sits between.
        timed = [r for r in rows if r["median_moving_time_s"] is not None]
        assert timed, "the seeded database should have timed attempts"
        for r in timed:
            assert r["best_moving_time_s"] <= r["median_moving_time_s"]

        # And it agrees with the detail endpoint's own median, computed differently.
        for rid, row in list(listed.items())[:3]:
            detail = rw_client.get(f"/api/routes/{rid}").json()
            assert detail["stats"]["median_time_s"] == row["median_moving_time_s"]

    def test_detail_polyline_is_columnar(self, rw_client, rw_store, route_id):
        body = rw_client.get(f"/api/routes/{route_id}").json()
        points = json.loads(_pick(rw_store,
                                  f"SELECT points FROM routes WHERE route_id = {route_id}"))
        columns = body["route"]["points"]
        assert [columns["lat"], columns["lon"], columns["altitude_m"],
                columns["distance_m"]] == [[p[i] for p in points] for i in range(4)]
        assert "signature" not in body["route"], "the clusterer's match key is not the UI's"

    def test_detail_attempts_and_stats_are_unchanged(self, rw_client, rw_store, route_id):
        body = rw_client.get(f"/api/routes/{route_id}").json()
        expected = _as_json(routes_mod.route_detail(rw_store, route_id))
        for key in ("attempts", "attempt_count", "counted_count", "stats",
                    "best_attempt", "worst_attempt"):
            _strict_equal(body[key], expected[key], key)
        assert body["attempt_count"] >= 2

    def test_detail_404s_for_an_unknown_route(self, rw_client):
        assert rw_client.get("/api/routes/999999").status_code == 404

    def test_segment_paths_are_columnar(self, rw_client, rw_store, route_id):
        body = rw_client.get(f"/api/routes/{route_id}/segments").json()
        expected = _as_json(routes_mod.segment_profile(rw_store, route_id))
        assert body["segments"], "the busiest seeded route should have segments"
        for got, want in zip(body["segments"], expected["segments"]):
            _strict_equal({k: v for k, v in got.items() if k != "path"},
                          {k: v for k, v in want.items() if k != "path"})
            assert got["path"]["lat"] == [p[0] for p in want["path"]]
            assert got["path"]["lon"] == [p[1] for p in want["path"]]
        # The rankings hold the same segments, converted once each, not twice.
        assert [s["seg_index"] for s in body["fastest_segments"]] == \
               [s["seg_index"] for s in expected["fastest_segments"]]
        assert all(isinstance(s["path"]["lat"], list) for s in body["slowest_segments"])

    def test_a_route_with_no_computed_segments_still_answers(self, rw_client, rw_store):
        rid = int(_pick(rw_store, "SELECT route_id FROM routes LIMIT 1"))
        rw_store.conn.execute("DELETE FROM route_segment_efforts WHERE route_id = ?", (rid,))
        rw_store.conn.commit()
        body = rw_client.get(f"/api/routes/{rid}/segments").json()
        assert body == {"route_id": rid, "name": None, "segment_m": None,
                        "attempts": 0, "segments": [],
                        "fastest_segments": [], "slowest_segments": []}

    def test_rename_pins_the_route(self, rw_client, rw_store, route_id):
        res = rw_client.patch(f"/api/routes/{route_id}", json={"name": "Corniche loop"})
        assert res.json() == {"route_id": route_id, "name": "Corniche loop", "pinned": True}
        assert int(_pick(rw_store, f"SELECT pinned FROM routes WHERE route_id = {route_id}")) == 1

    def test_rename_rejects_an_empty_name_and_a_missing_one(self, rw_client, route_id):
        assert rw_client.patch(f"/api/routes/{route_id}", json={"name": "  "}).status_code == 400
        # The body model makes a missing name a 422 rather than the 400 it used to be.
        assert rw_client.patch(f"/api/routes/{route_id}", json={}).status_code == 422
        assert rw_client.patch("/api/routes/999999", json={"name": "x"}).status_code == 404

    def test_split_then_merge_moves_the_attempts_back(self, rw_client, rw_store, route_id):
        members = [r["activity_id"] for r in rw_store.query(
            "SELECT activity_id FROM route_members WHERE route_id = ? ORDER BY activity_id",
            (route_id,))]
        assert len(members) >= 3

        split = rw_client.post(f"/api/routes/{route_id}/split",
                               json={"activity_ids": members[:1], "name": "Wrong day"}).json()
        assert split["from_route_id"] == route_id and split["moved"] == 1
        new_id = split["route_id"]
        assert _pick(rw_store, f"SELECT name FROM routes WHERE route_id = {new_id}") == "Wrong day"

        merged = rw_client.post(f"/api/routes/{route_id}/merge",
                                json={"route_ids": [new_id]}).json()
        assert merged == {"route_id": route_id, "merged": [new_id], "moved_activities": 1}
        assert rw_store.conn.execute(
            "SELECT 1 FROM routes WHERE route_id = ?", (new_id,)).fetchone() is None

    def test_split_errors_are_unchanged(self, rw_client, route_id):
        assert rw_client.post(f"/api/routes/{route_id}/split",
                              json={"activity_ids": ["nope"]}).status_code == 400
        assert rw_client.post("/api/routes/999999/split",
                              json={"activity_ids": ["a"]}).status_code == 404
        assert rw_client.post(f"/api/routes/{route_id}/merge",
                              json={"route_ids": [1]}).status_code in (200, 404)

    def test_delete_unclusters_rather_than_deleting_activities(self, rw_client, rw_store):
        rid = int(_pick(rw_store, "SELECT route_id FROM route_members LIMIT 1"))
        aid = _pick(rw_store, f"SELECT activity_id FROM route_members WHERE route_id = {rid}")
        assert rw_client.delete(f"/api/routes/{rid}").json() == {"deleted": True}
        assert rw_client.delete(f"/api/routes/{rid}").json() == {"deleted": False}
        assert rw_client.get(f"/api/activities/{aid}").json()["route"] is None

    def test_recluster_counts_what_it_did(self, rw_client):
        body = rw_client.post("/api/routes/recluster", json={}).json()
        assert set(body) == {"activities", "routes", "created", "joined", "no_gps",
                             "too_short", "kept_manual"}
        assert body["activities"] == sum(
            body[k] for k in ("created", "joined", "no_gps", "too_short", "kept_manual"))
        # An empty body is allowed and means the clusterer's own threshold.
        assert rw_client.post("/api/routes/recluster").status_code == 200
        assert rw_client.post("/api/routes/recluster",
                              json={"threshold": "tight"}).status_code == 422

    def test_the_track_endpoint_is_gone(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activities LIMIT 1")
        assert rw_client.get(f"/api/activities/{aid}/track").status_code == 404

    def test_typed_route_paths_reference_their_models(self, rw_settings):
        spec = TestClient(create_app(rw_settings)).get("/openapi.json").json()

        def ref(path: str, method: str) -> str:
            schema = spec["paths"][path][method]["responses"]["200"]["content"][
                "application/json"]["schema"]
            return schema["$ref"].rsplit("/", 1)[-1]

        assert ref("/api/routes/{route_id}", "get") == "RouteDetail"
        assert ref("/api/routes/{route_id}/segments", "get") == "RouteSegments"
        assert ref("/api/routes/{route_id}", "patch") == "RouteRenameResult"
        assert ref("/api/routes/{route_id}/merge", "post") == "RouteMergeResult"
        assert ref("/api/routes/{route_id}/split", "post") == "RouteSplitResult"
        assert ref("/api/routes/{route_id}", "delete") == "RouteDeleteResult"
        assert ref("/api/routes/recluster", "post") == "ReclusterResult"
        assert "/api/activities/{activity_id}/track" not in spec["paths"]


class TestRaceAndCompare:
    """T07: the `race` field resolved at the boundary, and compare's columnar tracks."""

    def test_race_defaults_to_zero_and_the_user_can_set_it(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activities LIMIT 1")
        assert rw_client.get(f"/api/activities/{aid}").json()["activity"]["race"] == 0

        assert rw_client.patch(f"/api/activities/{aid}", json={"race": True}).status_code == 200
        assert rw_client.get(f"/api/activities/{aid}").json()["activity"]["race"] == 1
        # It is a user-only field, so reverting clears it back to the fallback.
        rw_client.delete(f"/api/activities/{aid}/overrides/race")
        assert rw_client.get(f"/api/activities/{aid}").json()["activity"]["race"] == 0

    def test_garmins_event_type_fills_in_for_an_activity_the_user_has_not_marked(
        self, rw_client, rw_store
    ):
        aid = _pick(rw_store, "SELECT activity_id FROM activities WHERE raw_id IS NOT NULL LIMIT 1")
        raw_id = _pick(rw_store, f"SELECT raw_id FROM activities WHERE activity_id = '{aid}'")
        rw_store.conn.execute(
            "UPDATE raw_documents SET payload = ? WHERE id = ?",
            (json.dumps({"eventType": {"typeKey": "race"}}), raw_id),
        )
        rw_store.conn.commit()
        assert rw_client.get(f"/api/activities/{aid}").json()["activity"]["race"] == 1

        # And the user's answer still wins over it, in both directions.
        rw_client.patch(f"/api/activities/{aid}", json={"race": False})
        assert rw_client.get(f"/api/activities/{aid}").json()["activity"]["race"] == 0

    def test_the_race_filter_agrees_with_the_rows(self, rw_client, rw_store):
        aid = _pick(rw_store, "SELECT activity_id FROM activities LIMIT 1")
        rw_client.patch(f"/api/activities/{aid}", json={"race": True})

        races = rw_client.get("/api/activities?race=true&limit=1000").json()
        assert [r["activity_id"] for r in races["rows"]] == [aid]
        assert races["total"] == 1
        assert all(r["race"] == 1 for r in races["rows"])

        rest = rw_client.get("/api/activities?race=false&limit=1000").json()
        assert aid not in {r["activity_id"] for r in rest["rows"]}
        assert rest["total"] + races["total"] == rw_client.get("/api/activities").json()["total"]

    def test_compare_tracks_are_columnar(self, rw_client, rw_store):
        ids = [r["activity_id"] for r in rw_store.query(
            "SELECT DISTINCT s.activity_id FROM activity_samples s "
            "WHERE s.lat IS NOT NULL LIMIT 2")]
        assert len(ids) == 2
        body = rw_client.get(f"/api/routes/compare/tracks?ids={','.join(ids)}").json()
        assert body["count"] == 2

        for attempt, aid in zip(body["attempts"], ids):
            track = routes_mod.activity_track(rw_store, aid)
            streams = attempt["streams"]
            assert streams["activity_id"] == aid
            assert streams["sample_count"] == track["point_count"]
            for i, name in enumerate(track["fields"]):
                assert streams[name] == [p[i] for p in track["points"]], name
            # The same column names the single-activity streams endpoint uses.
            assert set(streams) == set(schemas.ActivityStreams.model_fields)

    def test_compare_bounds_are_unchanged(self, rw_client):
        assert rw_client.get("/api/routes/compare/tracks?ids=").status_code == 400
        assert rw_client.get(
            "/api/routes/compare/tracks?ids=a,b,c,d,e,f").status_code == 400

    def test_the_new_models_are_in_the_spec(self, rw_settings):
        spec = TestClient(create_app(rw_settings)).get("/openapi.json").json()
        assert spec["paths"]["/api/routes/compare/tracks"]["get"]["responses"]["200"][
            "content"]["application/json"]["schema"]["$ref"].endswith("CompareTracks")
        assert "race" in spec["components"]["schemas"]["ActivityRow"]["properties"]
        params = {p["name"] for p in spec["paths"]["/api/activities"]["get"]["parameters"]}
        assert "race" in params
