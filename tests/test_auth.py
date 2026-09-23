"""The app password, session cookies and the request gate.

The tests that matter: the plaintext password never reaches disk, a stolen database
cannot be replayed as a live session, and the gate actually gates.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.api import auth
from garmin_analytics.api.server import create_app
from garmin_analytics.ingest import connect


class TestPassword:
    def test_password_is_not_stored_in_plaintext(self, store):
        auth.set_password(store, "hunter2-correct-horse")
        stored = " ".join(
            str(r) for r in store.query("SELECT key, value FROM app_settings")
        )
        assert "hunter2-correct-horse" not in stored
        assert store.get_setting("auth.password_hash")

    def test_verify_accepts_the_right_password_only(self, store):
        auth.set_password(store, "s3cret")
        assert auth.verify_password(store, "s3cret") is True
        assert auth.verify_password(store, "s3cre") is False
        assert auth.verify_password(store, "") is False

    def test_the_salt_makes_two_identical_passwords_hash_differently(self, store, settings):
        from garmin_analytics.db.store import Store

        auth.set_password(store, "same")
        first = store.get_setting("auth.password_hash")
        auth.set_password(store, "same")
        assert store.get_setting("auth.password_hash") != first

    def test_verify_on_an_unconfigured_store_is_false(self, store):
        assert auth.password_is_set(store) is False
        assert auth.verify_password(store, "anything") is False

    def test_empty_password_is_rejected(self, store):
        with pytest.raises(ValueError):
            auth.set_password(store, "")


class TestEnvReconciliation:
    def test_absent_when_nothing_is_configured(self, store):
        assert auth.sync_password_from_env(store, "") == "absent"
        assert auth.auth_required(store) is False

    def test_set_on_first_run(self, store):
        assert auth.sync_password_from_env(store, "first") == "set"
        assert auth.auth_required(store) is True

    def test_unchanged_on_restart_with_the_same_value(self, store):
        auth.sync_password_from_env(store, "same")
        assert auth.sync_password_from_env(store, "same") == "unchanged"

    def test_rotating_the_env_var_invalidates_existing_sessions(self, store):
        """Otherwise changing the password leaves every open browser signed in."""
        auth.sync_password_from_env(store, "old")
        token = auth.create_session(store)
        assert auth.session_valid(store, token) is True

        assert auth.sync_password_from_env(store, "new") == "rotated"
        assert auth.session_valid(store, token) is False
        assert auth.verify_password(store, "new") is True

    def test_clearing_the_env_var_keeps_the_stored_password(self, store):
        """An empty APP_PASSWORD on one restart must not silently unlock the app."""
        auth.sync_password_from_env(store, "set-once")
        assert auth.sync_password_from_env(store, "") == "unchanged"
        assert auth.auth_required(store) is True


class TestSessions:
    def test_only_the_hash_is_stored(self, store):
        token = auth.create_session(store)
        rows = store.query("SELECT token_hash FROM sessions")
        assert rows[0]["token_hash"] != token
        assert len(rows[0]["token_hash"]) == 64          # sha256 hex

    def test_a_forged_token_is_rejected(self, store):
        auth.create_session(store)
        assert auth.session_valid(store, "not-a-real-token") is False
        assert auth.session_valid(store, None) is False

    def test_destroy_session(self, store):
        token = auth.create_session(store)
        assert auth.destroy_session(store, token) is True
        assert auth.session_valid(store, token) is False

    def test_an_expired_session_is_invalid_and_purged(self, store):
        token = auth.create_session(store, ttl_days=-1)
        assert auth.session_valid(store, token) is False
        auth.purge_expired(store)
        assert auth.session_count(store) == 0

    def test_sessions_are_independent(self, store):
        a = auth.create_session(store)
        b = auth.create_session(store)
        auth.destroy_session(store, a)
        assert auth.session_valid(store, b) is True


class TestGate:
    @pytest.fixture
    def protected(self, seeded_db, fake_ui):
        """An app with a password set, and a fresh client."""
        from dataclasses import replace

        settings = replace(seeded_db, app_password="test-gate-password", ui_dir=fake_ui)
        app = create_app(settings)
        client = TestClient(app, follow_redirects=False)
        yield client
        # The seeded database is session-scoped; undo the password so other tests
        # that use it are not suddenly gated.
        from garmin_analytics.db.store import Store

        with Store.open(seeded_db) as st:
            st.conn.execute("DELETE FROM app_settings WHERE key LIKE 'auth.%'")
            st.conn.execute("DELETE FROM sessions")
            st.conn.commit()

    def test_api_is_401_without_a_session(self, protected):
        assert protected.get("/api/summary").status_code == 401
        assert protected.get("/api/activities").status_code == 401

    def test_the_page_redirects_to_the_login_screen(self, protected):
        res = protected.get("/")
        assert res.status_code == 302
        assert res.headers["location"] == "/login"

    def test_health_and_login_assets_stay_public(self, protected):
        """A health check that needs a cookie is not a health check."""
        assert protected.get("/api/health").status_code == 200
        assert protected.get("/api/auth/status").status_code == 200
        assert protected.get("/login").status_code == 200
        assert protected.get("/assets/index-abc123.js").status_code == 200

    def test_wrong_password_is_rejected(self, protected):
        assert protected.post("/api/auth/login", json={"password": "nope"}).status_code == 401

    def test_right_password_opens_everything(self, protected):
        res = protected.post("/api/auth/login", json={"password": "test-gate-password"})
        assert res.status_code == 200
        assert auth.COOKIE_NAME in res.cookies
        assert protected.get("/api/summary").status_code == 200
        assert protected.get("/").status_code == 200

    def test_the_cookie_is_httponly(self, protected):
        """A session cookie readable from JavaScript is one XSS away from stolen."""
        res = protected.post("/api/auth/login", json={"password": "test-gate-password"})
        set_cookie = res.headers["set-cookie"].lower()
        assert "httponly" in set_cookie
        assert "samesite=lax" in set_cookie

    def test_logout_closes_the_session(self, protected):
        protected.post("/api/auth/login", json={"password": "test-gate-password"})
        assert protected.get("/api/summary").status_code == 200
        protected.post("/api/auth/logout")
        assert protected.get("/api/summary").status_code == 401

    def test_writes_are_gated_too(self, protected):
        """Read gating with open writes would be worse than no gate at all."""
        assert protected.post("/api/gear", json={"kind": "shoe",
                                                 "nickname": "x"}).status_code == 401
        assert protected.patch("/api/activities/whatever",
                               json={"rpe": 5}).status_code == 401
        assert protected.post("/api/sync/start", json={}).status_code == 401


class TestUnprotected:
    def test_no_password_means_no_gate(self, seeded_db):
        """Running open on a laptop is a legitimate choice; it must still work."""
        client = TestClient(create_app(seeded_db))
        assert client.get("/api/summary").status_code == 200
        assert client.get("/api/auth/status").json()["auth_required"] is False

    def test_config_reports_that_it_is_unprotected(self, seeded_db):
        client = TestClient(create_app(seeded_db))
        assert client.get("/api/config").json()["auth_required"] is False


class TestGarminConnection:
    def test_status_reports_disconnected_without_touching_the_network(self, settings):
        s = auth.garmin_status(settings)
        assert s["connected"] is False
        assert s["tokens_updated_at"] is None

    def test_status_sees_a_token_cache(self, settings):
        token_dir = settings.token_dir
        token_dir.mkdir(parents=True, exist_ok=True)
        (token_dir / connect.TOKEN_FILENAME).write_text("{}")
        s = auth.garmin_status(settings)
        assert s["connected"] is True
        assert s["tokens_updated_at"] is not None

    def test_login_requires_both_fields(self, settings):
        with pytest.raises(ValueError):
            auth.garmin_login(settings, "", "")

    def test_an_expired_mfa_challenge_is_rejected(self, settings):
        with pytest.raises(LookupError):
            auth.garmin_mfa(settings, "no-such-challenge", "123456")

    def test_mfa_challenges_are_single_use(self, settings, monkeypatch):
        """A replayed challenge id must not resume someone else's login."""
        auth._MFA_CHALLENGES["cid"] = (auth.time.monotonic() + 600, {"state": 1})
        monkeypatch.setattr(
            "garmin_analytics.ingest.connect.finish_login",
            lambda state, code, token_dir: "Test Athlete",
        )
        assert auth.garmin_mfa(settings, "cid", "123456")["status"] == "ok"
        with pytest.raises(LookupError):
            auth.garmin_mfa(settings, "cid", "123456")

    def test_disconnect_removes_the_token_cache(self, settings):
        settings.token_dir.mkdir(parents=True, exist_ok=True)
        (settings.token_dir / connect.TOKEN_FILENAME).write_text("{}")
        out = auth.garmin_disconnect(settings)
        assert out["removed_files"] == 1
        assert out["connected"] is False

    def test_disconnect_leaves_everything_else_on_the_volume_alone(self, settings):
        """The token directory is a bind mount in the Docker deployment; disconnecting
        an account is not a licence to delete whatever else is in it."""
        settings.token_dir.mkdir(parents=True, exist_ok=True)
        bystander = settings.token_dir / "notes.json"
        bystander.write_text("{}")
        auth.garmin_disconnect(settings)
        assert bystander.exists()
