"""Time zone, heart rate and password chosen in Settings rather than in `.env`."""

from __future__ import annotations

import math
import time

import pytest
from fastapi.testclient import TestClient

from odeda import basics
from odeda.api import auth
from odeda.api.server import create_app
from odeda.config import load_settings
from odeda.db.store import Store


@pytest.fixture(autouse=True)
def _keep_process_timezone(monkeypatch):
    """`basics.save` changes the process time zone; put it back afterwards."""
    monkeypatch.setenv("TZ", "Etc/UTC")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def _walk(store, activity_id="a1", avg_hr=150, minutes=30):
    store.conn.execute(
        "INSERT INTO activities (activity_id, day, start_time_local, activity_type, avg_hr, moving_time_s, "
        "duration_s, trimp) VALUES (?, '2026-11-01', '2026-11-01 07:00:00', 'running', ?, ?, ?, 0)",
        (activity_id, avg_hr, minutes * 60, minutes * 60),
    )
    store.conn.commit()


class TestValidation:
    def test_a_real_zone_is_accepted_and_a_typo_is_not(self):
        assert basics.validate_timezone(" Asia/Qatar ") == "Asia/Qatar"
        with pytest.raises(ValueError, match="unknown time zone"):
            basics.validate_timezone("Asia/Qatarr")
        with pytest.raises(ValueError):
            basics.validate_timezone("")

    @pytest.mark.parametrize(
        "rest, maximum",
        [(20, 190), (52, 300), (52, 80), (120, 190), (100, 130)],
    )
    def test_heart_rates_outside_reason_are_refused(self, rest, maximum):
        with pytest.raises(ValueError):
            basics.validate_heart_rate(rest, maximum)

    def test_the_reserve_must_leave_room_for_the_load_maths(self):
        # 100 to 130 is a reserve of 30, below the 40 the TRIMP division needs.
        with pytest.raises(ValueError, match="at least"):
            basics.validate_heart_rate(100, 130)
        assert basics.validate_heart_rate(52, 187) == (52, 187)


class TestSave:
    def test_saved_values_are_in_force_and_survive_a_restart(self, settings, store):
        basics.save(store, settings, "Asia/Qatar", 48, 183)
        assert (settings.hr_rest, settings.hr_max) == (48, 183)
        assert basics.current_timezone() == "Asia/Qatar"
        # A new process: fresh settings from the environment (50 / 190), then the saved
        # values applied on top.
        restarted = load_settings()
        assert (restarted.hr_rest, restarted.hr_max) == (50, 190)
        basics.apply_saved(store, restarted)
        assert (restarted.hr_rest, restarted.hr_max) == (48, 183)
        assert basics.read(store, restarted)["hr_rest_default"] == 50

    def test_with_nothing_saved_the_environment_decides(self, settings, store):
        shown = basics.read(store, settings)
        assert shown["saved"] is False
        assert (shown["hr_rest"], shown["hr_max"]) == (50, 190)

    def test_changing_heart_rate_recomputes_stored_load(self, settings, store):
        _walk(store)  # 30 min at 150 bpm, no zone data, so the average-HR formula applies
        from odeda.analytics import load as load_mod

        load_mod.recompute_trimp(store)  # what ingest would have stored with 50 / 190
        # Banister, male, k = 1.92: minutes * hrr * 0.64 * exp(k * hrr).
        hrr = (150 - 50) / (190 - 50)
        before = 30 * hrr * 0.64 * math.exp(1.92 * hrr)
        assert store.query("SELECT trimp FROM activities")[0]["trimp"] == pytest.approx(before)
        out = basics.save(store, settings, "Etc/UTC", 60, 180)
        hrr = (150 - 60) / (180 - 60)
        after = 30 * hrr * 0.64 * math.exp(1.92 * hrr)
        assert out["recomputed"] == 1
        assert after > before
        assert store.query("SELECT trimp FROM activities")[0]["trimp"] == pytest.approx(after)

    def test_saving_the_same_heart_rate_recomputes_nothing(self, settings, store):
        _walk(store)
        assert basics.save(store, settings, "Etc/UTC", 50, 190)["recomputed"] == 0

    def test_a_refused_save_changes_nothing(self, settings, store):
        with pytest.raises(ValueError):
            basics.save(store, settings, "Nowhere/Land", 48, 183)
        assert (settings.hr_rest, settings.hr_max) == (50, 190)
        assert store.get_setting(basics.KEY_REST) is None


class TestPasswordFromSettings:
    def test_it_needs_the_current_password(self, store):
        auth.set_password(store, "old-password-1", source="env")
        with pytest.raises(PermissionError):
            auth.change_password(store, "nope", "brand-new-pass")
        auth.change_password(store, "old-password-1", "brand-new-pass")
        assert auth.verify_password(store, "brand-new-pass")
        assert not auth.verify_password(store, "old-password-1")

    def test_a_short_password_is_refused(self, store):
        with pytest.raises(ValueError, match="at least"):
            auth.change_password(store, "", "short")

    def test_other_browsers_are_signed_out_and_this_one_is_not(self, store):
        auth.set_password(store, "old-password-1")
        mine = auth.create_session(store)
        theirs = auth.create_session(store)
        auth.change_password(store, "old-password-1", "brand-new-pass", keep_token=mine)
        assert auth.session_valid(store, mine)
        assert not auth.session_valid(store, theirs)

    def test_a_password_chosen_in_settings_survives_a_restart(self, store):
        # .env still holds the first password; Settings changed it afterwards.
        assert auth.sync_password_from_env(store, "from-the-env") == "set"
        auth.change_password(store, "from-the-env", "chosen-in-settings")
        assert auth.sync_password_from_env(store, "from-the-env") == "unchanged"
        assert auth.verify_password(store, "chosen-in-settings")

    def test_editing_the_env_afterwards_still_rotates(self, store):
        auth.sync_password_from_env(store, "from-the-env")
        auth.change_password(store, "from-the-env", "chosen-in-settings")
        assert auth.sync_password_from_env(store, "a-newer-env-value") == "rotated"
        assert auth.verify_password(store, "a-newer-env-value")


class TestApi:
    @pytest.fixture
    def client(self, settings, fake_ui):
        from dataclasses import replace

        return TestClient(create_app(replace(settings, ui_dir=fake_ui)))

    def test_basics_round_trip(self, client):
        assert client.get("/api/basics").json()["saved"] is False
        res = client.put(
            "/api/basics", json={"timezone": "Asia/Qatar", "hr_rest": 48, "hr_max": 183}
        )
        assert res.status_code == 200
        body = client.get("/api/basics").json()
        assert body["timezone"] == "Asia/Qatar" and body["hr_rest"] == 48 and body["saved"]
        assert client.get("/api/config").json()["athlete"]["hr_max"] == 183

    def test_a_bad_value_is_a_400_with_the_reason(self, client):
        res = client.put("/api/basics", json={"timezone": "Mars/Base", "hr_rest": 48, "hr_max": 183})
        assert res.status_code == 400 and "time zone" in res.json()["detail"]

    def test_setup_says_what_is_left(self, client, store):
        assert client.get("/api/setup").json() == {
            "activities": 0,
            "garmin_connected": False,
            "basics_saved": False,
            "password_set": False,
        }
        _walk(store)
        assert client.get("/api/setup").json()["activities"] == 1

    def test_choosing_a_first_password_keeps_this_browser_signed_in(self, client):
        res = client.post("/api/auth/password", json={"current": "", "new": "first-password"})
        assert res.status_code == 200 and res.json()["auth_required"] is True
        # Now gated, and the cookie set on that response still opens the door.
        assert client.get("/api/setup").status_code == 200
        client.cookies.clear()
        assert client.get("/api/setup").status_code == 401

    def test_a_wrong_current_password_is_a_403(self, client, monkeypatch):
        monkeypatch.setattr("time.sleep", lambda _s: None)
        client.post("/api/auth/password", json={"current": "", "new": "first-password"})
        res = client.post("/api/auth/password", json={"current": "bad", "new": "second-password"})
        assert res.status_code == 403
