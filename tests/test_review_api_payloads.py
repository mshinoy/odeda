"""A malformed request body is a 400, never an unhandled 500.

Found by the adversarial review pass of 2026-09-22 (docs/history/DECISIONS.md D43; the review
itself is in git history: `git show 0a9d297:REVIEW.md`). Every test here failed
against the code as first written.
"""

from __future__ import annotations

import pytest




@pytest.fixture
def client(settings):
    from fastapi.testclient import TestClient

    from garmin_analytics.api.server import create_app

    return TestClient(create_app(settings))


# T12 typed the gear bodies, so the shape is now rejected by the model rather than
# by `clean_attrs`: an unknown or mistyped key is a 422 naming the key, and only a
# body the model accepts and `create` then refuses is still a 400. Both are client
# errors, which is what this module is about; the codes are pinned so the split
# stays deliberate.
@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"store": 1, "nickname": "x"}, 422),    # collides with a positional parameter
        ({"gear_id": 7, "nickname": "x"}, 422),  # ditto
        ({"nickname": "x", "initial_distance_m": "not a number"}, 422),
        ({"nickname": "x", "initial_distance_m": -5}, 422),
        ({"nickname": "x", "purchase_date": "the day before yesterday"}, 400),
        ({}, 400),                               # no nickname, brand or model
    ],
)
def test_bad_gear_payload_is_a_client_error(client, body, status):
    assert client.post("/api/gear", json=body).status_code == status


def test_duplicate_garmin_uuid_is_a_client_error(client):
    assert client.post("/api/gear", json={"nickname": "a", "garmin_uuid": "U1"}).status_code == 200
    assert client.post("/api/gear", json={"nickname": "b", "garmin_uuid": "U1"}).status_code == 400


def test_bad_gear_update_payload_is_a_client_error(client):
    gid = client.post("/api/gear", json={"nickname": "shoes"}).json()["gear_id"]
    assert client.patch(f"/api/gear/{gid}", json={"gear_id": 99}).status_code == 422
    assert client.patch(f"/api/gear/{gid}", json={"purchase_date": "nope"}).status_code == 400


def test_a_patch_can_clear_a_field(client):
    """`exclude_unset`, not `exclude_none`: a null the caller sent is a clear."""
    gid = client.post("/api/gear", json={"nickname": "shoes", "notes": "new"}).json()["gear_id"]
    assert client.patch(f"/api/gear/{gid}", json={"notes": None}).json()["notes"] is None
    # A field left out of the body is untouched.
    assert client.patch(f"/api/gear/{gid}", json={"brand": "Asics"}).json()["nickname"] == "shoes"


def test_bulk_override_rejects_a_non_list_of_ids(client):
    r = client.post("/api/overrides/bulk", json={"activity_ids": "abc", "field": "notes",
                                                 "value": "x"})
    assert r.status_code == 400
