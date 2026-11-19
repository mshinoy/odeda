"""`GA_DEMO=1`: a read-only instance. Reads work, every change is refused."""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from odeda.api.server import create_app


@pytest.fixture
def demo(settings, fake_ui):
    return TestClient(create_app(replace(settings, ui_dir=fake_ui, demo=True)))


@pytest.fixture
def normal(settings, fake_ui):
    return TestClient(create_app(replace(settings, ui_dir=fake_ui)))


def test_the_flag_is_reported_so_the_ui_can_say_so(demo, normal):
    assert demo.get("/api/config").json()["demo"] is True
    assert normal.get("/api/config").json()["demo"] is False


def test_reads_still_work(demo):
    assert demo.get("/api/config").status_code == 200
    assert demo.get("/api/setup").status_code == 200


@pytest.mark.parametrize(
    "method, path",
    [
        ("put", "/api/basics"),
        ("post", "/api/auth/password"),
        ("post", "/api/garmin/login"),
        ("post", "/api/sync/start"),
        ("post", "/api/plan/upload"),
        ("delete", "/api/plan/source"),
        ("patch", "/api/activities/a1"),
        ("post", "/api/gear"),
        # A route that does not exist is refused too: the guard is by method, so a
        # route added later is covered without being listed.
        ("post", "/api/something/new"),
    ],
)
def test_every_change_is_refused_with_the_reason(demo, method, path):
    res = demo.request(method.upper(), path, json={})
    assert res.status_code == 403
    assert "read-only demo" in res.json()["detail"]


def test_the_upload_preview_stays_open(demo):
    res = demo.post(
        "/api/plan/upload/preview",
        json={"content": "date,title,distance_km\n2026-11-20,Easy run,5\n",
              "effective_day": "2026-11-20", "label": "x"},
    )
    assert res.status_code != 403


def test_a_normal_instance_is_not_affected(normal):
    res = normal.put("/api/basics", json={"timezone": "Asia/Qatar", "hr_rest": 48, "hr_max": 183})
    assert res.status_code == 200


def test_a_demo_has_no_sign_in_even_with_a_password_set(settings, fake_ui):
    client = TestClient(
        create_app(replace(settings, ui_dir=fake_ui, demo=True, app_password="secret-pass-1"))
    )
    assert client.get("/api/setup").status_code == 200
    assert client.get("/api/config").json()["auth_required"] is False
