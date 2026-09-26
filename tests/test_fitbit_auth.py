"""The Fitbit OAuth flow, driven end to end without a Fitbit account.

The credential belongs to one person's Fitbit app, so none of this can be proved
against the real service here. What *can* be proved is that given the payloads Fitbit
documents, this module does the right thing — and that is what these tests do, through
the injected transport, the way `test_login_transport.py` does for Garmin.

The properties that matter, in the order they will bite:

  * PKCE is computed the way the spec says, unpadded, or Fitbit rejects the exchange.
  * `state` is checked, or the redirect is forgeable.
  * **A refresh returns a new refresh token and the old one dies.** If the rotation is
    not written to disk, the next sync — hours later — fails with no explanation.
  * A 401 mid-request refreshes once and retries, and a second 401 stops.
  * A 429 is a typed error carrying when to come back, not a crash.
  * Google's `UNAUTHENTICATED` envelope is read, because that is what a 401 looks like
    now that Fitbit's auth layer is Google's.
  * The token cache is 0600 in a 0700 directory and no secret reaches a repr.
"""

from __future__ import annotations

import base64
import hashlib
import json
import stat

import pytest

from garmin_analytics.ingest import fitbit as F


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


def response(status: int, payload=None, headers=None, raw: bytes | None = None) -> F.Response:
    body = raw if raw is not None else json.dumps(payload or {}).encode("utf-8")
    return F.Response(status, headers or {"Content-Type": "application/json"}, body)


class FakeTransport:
    """Answers with whatever it was handed, and records exactly what it was asked."""

    def __init__(self, *replies: F.Response):
        self.replies = list(replies)
        self.calls: list[dict] = []

    def request(self, method, url, headers, body=None):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "headers": dict(headers),
                "body": body.decode("ascii") if body else None,
            }
        )
        if not self.replies:
            raise AssertionError(f"unexpected extra request: {method} {url}")
        return self.replies.pop(0)

    def form(self, index: int) -> dict[str, str]:
        from urllib.parse import parse_qs

        raw = self.calls[index]["body"] or ""
        return {k: v[0] for k, v in parse_qs(raw).items()}


CREDS = F.Credentials("test-client-id", "test-client-secret")

TOKEN_PAYLOAD = {
    "access_token": "access-1",
    "refresh_token": "refresh-1",
    "expires_in": 28800,
    "scope": "weight",
    "token_type": "Bearer",
    "user_id": "ABC123",
}

REFRESHED_PAYLOAD = {**TOKEN_PAYLOAD, "access_token": "access-2", "refresh_token": "refresh-2"}

#: What a 401 looks like since the auth layer became Google's: not Fitbit's
#: `{"errors": [...]}` but Google's error envelope, pointing at developers.google.com.
GOOGLE_UNAUTHENTICATED = {
    "error": {
        "code": 401,
        "message": "Request had invalid authentication credentials.",
        "status": "UNAUTHENTICATED",
    }
}

#: Fitbit's own classic shape, still what the data endpoints answer with.
FITBIT_ERRORS = {
    "errors": [{"errorType": "invalid_request", "message": "Invalid date range: 90 days"}]
}


def a_client(tmp_path, *replies, now=1_000_000.0, tokens=None):
    transport = FakeTransport(*replies)
    client = F.FitbitClient(
        CREDS,
        tokens or F.Tokens("access-1", "refresh-1", expires_at=now + 28800, user_id="ABC123"),
        tmp_path,
        transport=transport,
        clock=lambda: now,
    )
    return client, transport


# ---------------------------------------------------------------------------


class TestPKCE:
    def test_challenge_matches_the_spec(self):
        """S256 = BASE64URL(SHA256(ASCII(verifier))), and the padding must be stripped.

        Hand-derived: Fitbit compares its stored challenge against the one it derives
        from the verifier, so an `=` on either end makes two identical verifiers look
        different and the exchange fails with an error that blames the code.
        """
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        expected = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
        assert F.code_challenge(verifier) == expected
        assert "=" not in F.code_challenge(verifier)

    def test_the_authorize_url_asks_for_weight_and_nothing_else(self):
        from urllib.parse import parse_qs, urlparse

        pending = F.begin_authorization("cid", "http://localhost:8000/api/fitbit/callback")
        parsed = urlparse(pending.url)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == F.AUTHORIZE_URL
        assert params["scope"] == "weight"
        assert params["response_type"] == "code"
        assert params["code_challenge_method"] == "S256"
        assert params["code_challenge"] == F.code_challenge(pending.verifier)
        assert params["state"] == pending.state
        assert params["redirect_uri"] == "http://localhost:8000/api/fitbit/callback"

    def test_two_attempts_never_share_a_verifier(self):
        first = F.begin_authorization("cid", "http://x/cb")
        second = F.begin_authorization("cid", "http://x/cb")
        assert first.verifier != second.verifier
        assert first.state != second.state

    def test_the_verifier_is_not_in_the_repr(self):
        pending = F.begin_authorization("cid", "http://x/cb")
        assert pending.verifier not in repr(pending)


class TestExtractCode:
    def test_accepts_the_whole_redirect_url(self):
        url = "http://localhost:8000/api/fitbit/callback?code=abc123def&state=s1"
        assert F.extract_code(url, "s1") == "abc123def"

    def test_accepts_a_bare_code(self):
        assert F.extract_code("abc123def") == "abc123def"

    def test_rejects_a_redirect_from_another_attempt(self):
        """The anti-forgery check, done here so no route can forget it."""
        url = "http://localhost:8000/api/fitbit/callback?code=abc123def&state=other"
        with pytest.raises(F.FitbitError, match="different sign-in attempt"):
            F.extract_code(url, "s1")

    def test_says_what_to_paste_when_it_is_not_there(self):
        with pytest.raises(F.FitbitError, match=r"\?code="):
            F.extract_code("https://www.fitbit.com/oauth2/authorize?client_id=x", None)

    def test_rejects_nothing(self):
        with pytest.raises(F.FitbitError, match="Nothing was pasted"):
            F.extract_code("   ")


class TestExchange:
    def test_sends_everything_fitbit_requires(self):
        pending = F.begin_authorization("test-client-id", "http://localhost:8000/cb")
        transport = FakeTransport(response(200, TOKEN_PAYLOAD))
        tokens = F.exchange_code(CREDS, pending, "the-code", transport, now=1000.0)

        call = transport.calls[0]
        assert call["method"] == "POST" and call["url"] == F.TOKEN_URL
        assert call["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
        form = transport.form(0)
        assert form["grant_type"] == "authorization_code"
        assert form["code"] == "the-code"
        assert form["code_verifier"] == pending.verifier
        # Byte-identical to the consent URL's, or Fitbit refuses the exchange.
        assert form["redirect_uri"] == pending.redirect_uri
        assert tokens.access_token == "access-1"
        assert tokens.expires_at == 1000.0 + 28800

    def test_authenticates_the_app_with_basic_auth(self):
        """The header is `Basic base64(client_id:client_secret)` — decoded here so a
        change to the encoding cannot pass by looking merely non-empty."""
        pending = F.begin_authorization("test-client-id", "http://localhost:8000/cb")
        transport = FakeTransport(response(200, TOKEN_PAYLOAD))
        F.exchange_code(CREDS, pending, "code", transport, now=0.0)
        header = transport.calls[0]["headers"]["Authorization"]
        assert header.startswith("Basic ")
        decoded = base64.b64decode(header.split(" ", 1)[1]).decode("utf-8")
        assert decoded == "test-client-id:test-client-secret"

    def test_a_spent_code_says_so_in_words(self):
        pending = F.begin_authorization("cid", "http://x/cb")
        transport = FakeTransport(
            response(400, {"error": "invalid_grant", "error_description": "Authorization code expired"})
        )
        with pytest.raises(F.NeedsReauthorization, match="Authorization code expired"):
            F.exchange_code(CREDS, pending, "stale", transport, now=0.0)

    def test_a_response_without_a_refresh_token_is_not_a_connection(self):
        """Writing it would report success and then fail on every run afterwards —
        the same trap `login_with_ticket` documents for Garmin."""
        pending = F.begin_authorization("cid", "http://x/cb")
        transport = FakeTransport(response(200, {"access_token": "a", "expires_in": 28800}))
        with pytest.raises(F.FitbitError, match="cannot be resumed"):
            F.exchange_code(CREDS, pending, "code", transport, now=0.0)


class TestRefreshRotation:
    def test_the_refresh_token_is_replaced_not_reused(self):
        """Fitbit rotates: the response carries a new refresh token and the old one is
        dead on arrival. Reusing it is the single most likely way to lose the account."""
        tokens = F.Tokens("access-1", "refresh-1", expires_at=0.0)
        transport = FakeTransport(response(200, REFRESHED_PAYLOAD))
        rotated = F.refresh_tokens(CREDS, tokens, transport, now=5000.0)

        assert transport.form(0)["refresh_token"] == "refresh-1"
        assert rotated.refresh_token == "refresh-2"
        assert rotated.access_token == "access-2"
        assert rotated.expires_at == 5000.0 + 28800

    def test_a_rejected_refresh_token_asks_for_consent_again(self):
        tokens = F.Tokens("access-1", "refresh-1", expires_at=0.0)
        transport = FakeTransport(response(401, GOOGLE_UNAUTHENTICATED))
        with pytest.raises(F.NeedsReauthorization, match="invalid authentication credentials"):
            F.refresh_tokens(CREDS, tokens, transport, now=0.0)

    def test_the_rotation_reaches_the_disk_before_anything_else_happens(self, tmp_path):
        """The failure this prevents is silent and hours late: a refresh that is used
        for the current run and never written leaves a dead token in the cache."""
        client, _ = a_client(
            tmp_path,
            response(200, REFRESHED_PAYLOAD),
            response(200, {"weight": []}),
            now=1_000_000.0,
            tokens=F.Tokens("access-1", "refresh-1", expires_at=0.0),
        )
        client.get("/1/user/-/body/log/weight/date/2026-01-01.json")

        saved = json.loads(F.token_file(tmp_path).read_text())
        assert saved["refresh_token"] == "refresh-2"
        assert saved["access_token"] == "access-2"


class TestExpiry:
    def test_a_token_inside_its_eight_hours_is_used_as_is(self, tmp_path):
        client, transport = a_client(tmp_path, response(200, {"weight": []}))
        client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert len(transport.calls) == 1
        assert transport.calls[0]["headers"]["Authorization"] == "Bearer access-1"

    def test_a_token_inside_the_skew_window_is_refreshed_first(self, tmp_path):
        """Refreshing 5 minutes early costs one call; expiring mid-backfill costs the
        run. `expires_at - EXPIRY_SKEW_S` is the line."""
        now = 1_000_000.0
        client, transport = a_client(
            tmp_path,
            response(200, REFRESHED_PAYLOAD),
            response(200, {"weight": []}),
            now=now,
            tokens=F.Tokens("access-1", "refresh-1", expires_at=now + F.EXPIRY_SKEW_S - 1),
        )
        client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert transport.calls[0]["url"] == F.TOKEN_URL
        assert transport.calls[1]["headers"]["Authorization"] == "Bearer access-2"


class TestUnexpected401:
    def test_a_surprise_401_refreshes_once_and_retries(self, tmp_path):
        """A container clock can be wrong and Fitbit can revoke early, so the proactive
        expiry check is not enough on its own."""
        client, transport = a_client(
            tmp_path,
            response(401, GOOGLE_UNAUTHENTICATED),
            response(200, REFRESHED_PAYLOAD),
            response(200, {"weight": [{"date": "2026-01-01", "weight": 76.0}]}),
        )
        payload = client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert payload["weight"][0]["weight"] == 76.0
        assert [c["url"] for c in transport.calls][1] == F.TOKEN_URL
        assert len(transport.calls) == 3

    def test_a_second_401_stops_instead_of_looping(self, tmp_path):
        client, transport = a_client(
            tmp_path,
            response(401, GOOGLE_UNAUTHENTICATED),
            response(200, REFRESHED_PAYLOAD),
            response(401, GOOGLE_UNAUTHENTICATED),
        )
        with pytest.raises(F.NeedsReauthorization, match="revoked"):
            client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert len(transport.calls) == 3


class TestRateLimit:
    def test_429_carries_when_to_come_back(self, tmp_path):
        client, _ = a_client(
            tmp_path,
            response(429, FITBIT_ERRORS, headers={"fitbit-rate-limit-reset": "1830"}),
        )
        with pytest.raises(F.RateLimited) as caught:
            client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert caught.value.retry_after_s == 1830
        assert "1830" in str(caught.value)

    def test_the_hour_is_the_fallback_when_no_header_says(self, tmp_path):
        client, _ = a_client(tmp_path, response(429, FITBIT_ERRORS))
        with pytest.raises(F.RateLimited) as caught:
            client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert caught.value.retry_after_s == 3600

    def test_the_remaining_budget_is_read_off_every_response(self, tmp_path):
        """So a backfill can pace itself instead of waiting for the 429 it can see."""
        client, _ = a_client(
            tmp_path,
            response(200, {"weight": []}, headers={"fitbit-rate-limit-remaining": "17"}),
        )
        client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert client.remaining == 17


class TestErrorEnvelopes:
    def test_reads_googles_unauthenticated_shape(self):
        assert "invalid authentication credentials" in F.error_message(
            response(401, GOOGLE_UNAUTHENTICATED)
        )

    def test_reads_fitbits_classic_shape(self):
        assert F.error_message(response(400, FITBIT_ERRORS)) == "Invalid date range: 90 days"

    def test_reads_oauths_own_shape(self):
        message = F.error_message(
            response(400, {"error": "invalid_grant", "error_description": "Refresh token expired"})
        )
        assert message == "invalid_grant: Refresh token expired"

    def test_falls_back_to_the_status_rather_than_dumping_html(self):
        """A gateway in front of Fitbit can answer HTML; the user gets a line, not a page."""
        assert F.error_message(response(502, raw=b"<html>Bad Gateway</html>")) == "HTTP 502"


class TestTheTokenCache:
    def test_it_is_written_0600_inside_a_0700_directory(self, tmp_path):
        directory = tmp_path / "tokens"
        F.save_tokens(F.Tokens("a", "r", expires_at=1.0, user_id="ABC"), directory)
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
        assert stat.S_IMODE(F.token_file(directory).stat().st_mode) == 0o600

    def test_it_round_trips(self, tmp_path):
        original = F.Tokens("a", "r", expires_at=1234.5, scope="weight", user_id="ABC")
        F.save_tokens(original, tmp_path)
        assert F.load_tokens(tmp_path) == original

    def test_a_half_written_cache_asks_for_consent_rather_than_crashing(self, tmp_path):
        F.token_file(tmp_path).write_text(json.dumps({"access_token": "a"}))
        with pytest.raises(F.NeedsReauthorization, match="incomplete"):
            F.load_tokens(tmp_path)

    def test_an_unreadable_cache_says_so(self, tmp_path):
        F.token_file(tmp_path).write_text("{not json")
        with pytest.raises(F.NeedsReauthorization, match="unreadable"):
            F.load_tokens(tmp_path)

    def test_nothing_there_is_not_an_error(self, tmp_path):
        assert F.load_tokens(tmp_path) is None
        assert F.is_connected(tmp_path) is False
        assert F.connected_account(tmp_path) == ""

    def test_disconnect_removes_only_the_fitbit_cache(self, tmp_path):
        """Garmin's cache lives in the same directory. `forget_tokens` names its file
        rather than globbing, for exactly this reason."""
        (tmp_path / "garmin_tokens.json").write_text("{}")
        F.save_tokens(F.Tokens("a", "r", expires_at=1.0), tmp_path)
        assert F.forget_tokens(tmp_path) == 1
        assert F.forget_tokens(tmp_path) == 0
        assert (tmp_path / "garmin_tokens.json").is_file()

    def test_resuming_without_a_cache_says_how_to_connect(self, tmp_path):
        with pytest.raises(F.NotConnected, match="fitbit connect"):
            F.FitbitClient.resume(tmp_path, creds=CREDS)


class TestSecretsStayOut:
    def test_the_client_secret_is_not_in_the_repr(self):
        assert "test-client-secret" not in repr(CREDS)

    def test_the_tokens_are_not_in_the_repr(self):
        assert "refresh-1" not in repr(F.Tokens("access-1", "refresh-1", expires_at=0.0))
        assert "access-1" not in repr(F.Tokens("access-1", "refresh-1", expires_at=0.0))

    def test_missing_environment_credentials_say_where_to_get_them(self, monkeypatch):
        monkeypatch.delenv("FITBIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("FITBIT_CLIENT_SECRET", raising=False)
        assert F.Credentials.configured() is False
        with pytest.raises(F.NotConnected, match="dev.fitbit.com"):
            F.Credentials.from_env()

    def test_environment_credentials_are_read_when_set(self, monkeypatch):
        monkeypatch.setenv("FITBIT_CLIENT_ID", "cid")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "csecret")
        assert F.Credentials.configured() is True
        assert F.Credentials.from_env().client_id == "cid"


class TestRequestShape:
    def test_weights_are_asked_for_in_metric_explicitly(self, tmp_path):
        """The default follows the account's locale. A silent switch to pounds would
        write a number three digits wrong into a column called weight_kg."""
        client, transport = a_client(tmp_path, response(200, {"weight": []}))
        client.get("/1/user/-/body/log/weight/date/2026-01-01.json")
        assert transport.calls[0]["headers"]["Accept-Language"] == "en_GB"

    def test_a_relative_path_is_resolved_against_the_api_root(self, tmp_path):
        client, transport = a_client(tmp_path, response(200, {}))
        client.get("1/user/-/profile.json")
        assert transport.calls[0]["url"] == "https://api.fitbit.com/1/user/-/profile.json"

    def test_the_display_name_comes_off_the_profile(self, tmp_path):
        client, _ = a_client(tmp_path, response(200, {"user": {"displayName": "Runner"}}))
        assert client.display_name() == "Runner"
