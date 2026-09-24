"""The two revert endpoints and their response models (`RevertFieldResult`,
`RevertAllResult`), which the Edit dialog's revert buttons read."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import fixtures as F
from garmin_analytics.api.server import create_app
from garmin_analytics.db.store import Store
from test_gym import _ingest

RUN_ID = str(F.ACTIVITY["activityId"])
GARMIN_NAME = F.ACTIVITY["activityName"]


@pytest.fixture
def client(settings):
    with Store.open(settings) as st, st.tx():
        _ingest(st, "connect", "activities", RUN_ID, F.ACTIVITY, F.ACTIVITY)
    return TestClient(create_app(settings))


def _edit(client, **values):
    res = client.patch(f"/api/activities/{RUN_ID}", json=values)
    assert res.status_code == 200, res.text


def test_one_field_back_to_garmin_and_the_rest_kept(client):
    _edit(client, activity_name="Katara loop", rpe=7)
    body = client.delete(f"/api/activities/{RUN_ID}/overrides/activity_name").json()
    assert body["reverted"] is True
    assert body["activity"]["activity_name"] == GARMIN_NAME
    assert body["activity"]["rpe"] == 7
    assert [o["field"] for o in body["overrides"]] == ["rpe"]


def test_a_field_without_an_edit_reverts_nothing(client):
    body = client.delete(f"/api/activities/{RUN_ID}/overrides/notes").json()
    assert body == {**body, "reverted": False, "overrides": []}


def test_an_unknown_field_is_a_400(client):
    assert client.delete(f"/api/activities/{RUN_ID}/overrides/nope").status_code == 400


def test_every_field_back_to_garmin(client):
    _edit(client, activity_name="Katara loop", rpe=7, excluded_from_stats=True)
    body = client.delete(f"/api/activities/{RUN_ID}/overrides").json()
    assert body["reverted"] == 3
    row = body["activity"]
    assert (row["activity_name"], row["rpe"], row["excluded_from_stats"], row["override_count"]) \
        == (GARMIN_NAME, None, None, 0)


def test_a_missing_activity_comes_back_null(client):
    assert client.delete("/api/activities/0/overrides").json() == {"reverted": 0, "activity": None}
