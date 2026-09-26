"""Who does the login, and what the data path is allowed to send.

Garmin fingerprints the client on the login route. Betting on a single browser
impersonation profile worked for one day and then answered 503 — so the bet is off:
`garminconnect` cascades through five sign-in strategies and falls through to the next
on a rate limit or a bot challenge. These tests pin the parts of that arrangement this
module is responsible for:

  * garth is gone, and nothing quietly imports it.
  * a re-login really re-authenticates instead of resuming the cache it was called to
    replace.
  * query strings reach the client as `params` — it rejects a `?` inside an API path,
    and every daily endpoint has one.
  * the failure shapes the sync loop branches on (404 as no-data, 429 as backoff) still
    come through, now as the library's own exception types.
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path

import pytest

from garmin_analytics.ingest import connect


@pytest.fixture(autouse=True)
def no_leaked_client():
    connect._set_client(None)
    yield
    connect._set_client(None)


class FakeInner:
    def __init__(self):
        self.logins: list[tuple[str, str]] = []
        self.dumped: list[str] = []

    def login(self, email, password, prompt_mfa=None, return_on_mfa=False):
        self.logins.append((email, password))
        return (None, None)

    def dump(self, path):
        self.dumped.append(path)
        target = Path(path) / connect.TOKEN_FILENAME
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"di_token": "x"}))


class FakeGarmin:
    """The wrapper's contract: `login(tokenstore=...)` resumes from the cache when one
    is there, and only falls back to the credentials when it is not."""

    def __init__(self, inner, display_name="test-athlete", **kwargs):
        self.client = inner
        self.display_name = display_name
        self.kwargs = kwargs
        self.resumed_from: str | None = None

    def login(self, tokenstore=None):
        if tokenstore and (Path(tokenstore) / connect.TOKEN_FILENAME).is_file():
            self.resumed_from = tokenstore
            return (None, None)
        status, _ = self.client.login(
            self.kwargs.get("email"), self.kwargs.get("password")
        )
        if tokenstore:
            self.client.dump(tokenstore)
        return (status, None)


class TestGarthIsGone:
    def test_the_module_does_not_reach_for_garth(self):
        src = inspect.getsource(connect)
        code = "\n".join(
            line for line in src.splitlines() if not line.lstrip().startswith("#")
        )
        # The module docstring explains why garth was dropped; that history is worth
        # keeping. An import or an attribute access is not.
        assert "import garth" not in code
        assert "garth." not in code

    def test_garth_is_not_installed(self):
        with pytest.raises(ImportError):
            __import__("garth")


class TestTokenFilename:
    def test_we_look_for_the_file_the_library_actually_writes(self, tmp_path):
        """Named rather than globbed, so `logout` cannot delete a bystander — which
        means a library that renames its cache would leave us reporting "not
        connected" forever. Catch that here instead of at someone's setup screen."""
        from garminconnect.client import token_file_path

        assert connect.token_file(tmp_path) == token_file_path(str(tmp_path))


class TestReLoginReplacesTheCache:
    def test_login_discards_the_existing_cache_before_authenticating(
        self, tmp_path, monkeypatch
    ):
        """Someone re-running `login` is saying the saved session is not good enough.
        Resuming it would report success and change nothing."""
        token_dir = tmp_path / "tokens"
        token_dir.mkdir()
        (token_dir / connect.TOKEN_FILENAME).write_text('{"di_token": "stale"}')

        inner = FakeInner()
        monkeypatch.setattr(connect, "_new_client", lambda **kw: FakeGarmin(inner, **kw))

        connect.login("me@example.com", "pw", token_dir)

        assert inner.logins == [("me@example.com", "pw")], (
            "the stale cache was resumed instead of being replaced"
        )

    def test_a_successful_login_leaves_the_session_ready_to_sync(
        self, tmp_path, monkeypatch
    ):
        inner = FakeInner()
        client = FakeGarmin(inner, email="me@example.com", password="pw")
        monkeypatch.setattr(connect, "_new_client", lambda **kw: client)

        connect.login("me@example.com", "pw", tmp_path / "tokens")

        assert connect._client() is client

    def test_the_token_cache_is_private(self, tmp_path, monkeypatch):
        token_dir = tmp_path / "tokens"
        monkeypatch.setattr(
            connect, "_new_client", lambda **kw: FakeGarmin(FakeInner(), **kw)
        )

        connect.login("me@example.com", "pw", token_dir)

        assert token_dir.stat().st_mode & 0o777 == 0o700
        assert (token_dir / connect.TOKEN_FILENAME).stat().st_mode & 0o777 == 0o600


class TestQuerySplitting:
    """`Client._run_request` raises on a `?` in the path — query strings belong in
    `params`. Every per-day endpoint carries one, so this is the whole data path."""

    def test_a_path_without_a_query_passes_through_untouched(self):
        assert connect.split_query("/hrv-service/hrv/2026-09-01") == (
            "/hrv-service/hrv/2026-09-01",
            None,
        )

    def test_a_query_becomes_params(self):
        base, params = connect.split_query(
            "/usersummary-service/usersummary/daily/u?calendarDate=2026-09-01"
        )
        assert base == "/usersummary-service/usersummary/daily/u"
        assert params == {"calendarDate": "2026-09-01"}

    def test_several_parameters_all_survive(self):
        _, params = connect.split_query("/x?startDate=2026-01-01&endDate=2026-01-02")
        assert params == {"startDate": "2026-01-01", "endDate": "2026-01-02"}

    @pytest.mark.parametrize("name", sorted(connect.ENDPOINTS))
    def test_every_endpoint_splits_into_a_path_the_client_accepts(self, name):
        path = connect.ENDPOINTS[name].path.format(user="athlete", date="2026-09-01")
        base, _ = connect.split_query(path)
        assert "?" not in base and "#" not in base

    def test_the_activity_paths_split_too(self):
        for template in (connect.ACTIVITIES_PATH, connect.ACTIVITY_ZONES_PATH):
            base, _ = connect.split_query(
                template.format(start=0, limit=100, activity_id="1")
            )
            assert "?" not in base

    def test_fetch_sends_the_query_as_params_not_in_the_path(self):
        seen: dict[str, object] = {}

        class Client:
            def connectapi(self, path, params=None):
                seen["path"] = path
                seen["params"] = params
                return {"ok": True}

        connect._set_client(Client())
        got = connect.fetch(
            "/weight-service/weight/dateRange?startDate=2026-09-01", delay=0
        )
        assert got == {"ok": True}
        assert seen["path"] == "/weight-service/weight/dateRange"
        assert seen["params"] == {"startDate": "2026-09-01"}


class TestFailureShapes:
    """The sync loop branches on status: 404 means the watch was off the wrist, 429
    means slow down. The library reports both as typed exceptions, not HTTPError."""

    def test_a_not_found_is_no_data_rather_than_a_failure(self):
        import garminconnect

        class Client:
            def connectapi(self, path, params=None):
                raise garminconnect.GarminConnectNotFoundError("nothing for that day")

        connect._set_client(Client())
        assert connect.fetch("/hrv-service/hrv/2026-09-01", delay=0) is None

    def test_a_rate_limit_is_recognised_as_one(self):
        import garminconnect

        exc = garminconnect.GarminConnectTooManyRequestsError("slow down")
        assert connect._status_of(exc) == 429

    def test_a_response_status_still_wins_when_one_is_attached(self):
        exc = RuntimeError("boom")
        exc.response = type("R", (), {"status_code": 404})()
        assert connect._status_of(exc) == 404

    def test_an_unrecognisable_failure_has_no_status(self):
        assert connect._status_of(RuntimeError("transport died")) is None


class TestFetchNeedsASession:
    def test_fetching_without_a_login_says_so(self):
        with pytest.raises(connect.NotAuthenticated):
            connect.fetch("/hrv-service/hrv/2026-09-01", delay=0)
