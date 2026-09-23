"""Login goes out over a browser-shaped TLS fingerprint; nothing else does.

Garmin's edge answers the login route with 429 to python-`requests` and plain curl, for
any account, real or invented — which reads exactly like a retired endpoint or a blocked
address, and is neither. Measured from one host on 2026-09-23, back to back:

    requests / curl    -> 429 Too Many Requests
    curl_cffi(chrome)  -> 401 INVALID_USERNAME_PASSWORD

So the transport is swapped for the login call and put back afterwards. These tests pin
the swap, the restore-on-failure, and the scope — the data path must keep the session it
was verified with.
"""

from __future__ import annotations

import pytest

from garmin_analytics.ingest import connect


class FakeSession:
    def __init__(self, name="original"):
        self.name = name
        self.headers = {"User-Agent": "garth/0.8.0"}
        self.closed = False

    def close(self):
        self.closed = True


class FakeGarth:
    def __init__(self):
        self.client = type("C", (), {"sess": FakeSession()})()


@pytest.fixture
def fake_garth(monkeypatch):
    g = FakeGarth()
    monkeypatch.setattr(connect, "_garth", lambda: g)
    return g


class TestImpersonatingTransport:
    def test_swaps_the_session_and_puts_the_original_back(self, fake_garth):
        original = fake_garth.client.sess

        with connect.impersonating_transport():
            swapped = fake_garth.client.sess
            assert swapped is not original
            assert type(swapped).__module__.startswith("curl_cffi")

        assert fake_garth.client.sess is original

    def test_carries_the_existing_headers_onto_the_new_session(self, fake_garth):
        fake_garth.client.sess.headers = {"User-Agent": "garth/0.8.0", "X-Keep": "yes"}

        with connect.impersonating_transport():
            headers = fake_garth.client.sess.headers
            assert headers.get("X-Keep") == "yes"
            assert headers.get("User-Agent") == "garth/0.8.0"

    def test_restores_the_original_even_when_the_login_raises(self, fake_garth):
        original = fake_garth.client.sess

        with pytest.raises(RuntimeError, match="login blew up"):
            with connect.impersonating_transport():
                raise RuntimeError("login blew up")

        assert fake_garth.client.sess is original, (
            "a failed login must not leave the client on the impersonating session"
        )

    def test_uses_a_browser_profile_not_a_script_shaped_one(self):
        assert connect.IMPERSONATE_PROFILE.startswith("chrome")


class TestScope:
    """The fingerprint workaround applies to login, and only to login."""

    def test_only_the_auth_functions_enter_the_impersonating_transport(self):
        import inspect

        src = inspect.getsource(connect)
        users = {
            name for name, obj in vars(connect).items()
            if inspect.isfunction(obj)
            and name != "impersonating_transport"          # its own docstring names it
            and "with impersonating_transport()" in inspect.getsource(obj)
        }
        assert users == {"login", "begin_login", "finish_login"}, (
            f"unexpected users of the impersonating transport: {sorted(users)}"
        )
        assert "impersonating_transport" in src

    def test_the_fetch_path_does_not_touch_the_session(self):
        import inspect

        for name in ("fetch_day", "sync", "_get"):
            fn = getattr(connect, name, None)
            if fn is None:
                continue
            assert "sess" not in inspect.getsource(fn), (
                f"{name} must leave the verified data transport alone"
            )
