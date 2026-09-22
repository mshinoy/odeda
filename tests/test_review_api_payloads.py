"""A malformed request body is a 400, never an unhandled 500.

Found by the adversarial review pass; see REVIEW.md. Every test here failed against
the code as first written.
"""

from __future__ import annotations

import pytest




@pytest.fixture
def client(settings):
    from fastapi.testclient import TestClient

    from garmin_analytics.api.server import create_app

    return TestClient(create_app(settings))


@pytest.mark.parametrize(
    "body",
    [
        {"store": 1, "nickname": "x"},          # collides with a positional parameter
        {"gear_id": 7, "nickname": "x"},        # ditto
        {"nickname": "x", "initial_distance_m": "not a number"},
        {"nickname": "x", "purchase_date": "the day before yesterday"},
    ],
)
def test_bad_gear_payload_is_a_client_error(client, body):
    assert client.post("/api/gear", json=body).status_code == 400


def test_duplicate_garmin_uuid_is_a_client_error(client):
    assert client.post("/api/gear", json={"nickname": "a", "garmin_uuid": "U1"}).status_code == 200
    assert client.post("/api/gear", json={"nickname": "b", "garmin_uuid": "U1"}).status_code == 400


def test_bad_gear_update_payload_is_a_client_error(client):
    gid = client.post("/api/gear", json={"nickname": "shoes"}).json()["gear_id"]
    assert client.patch(f"/api/gear/{gid}", json={"gear_id": 99}).status_code == 400
    assert client.patch(f"/api/gear/{gid}", json={"purchase_date": "nope"}).status_code == 400


def test_bulk_override_rejects_a_non_list_of_ids(client):
    r = client.post("/api/overrides/bulk", json={"activity_ids": "abc", "field": "notes",
                                                 "value": "x"})
    assert r.status_code == 400
