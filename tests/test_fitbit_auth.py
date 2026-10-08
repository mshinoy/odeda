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

#: A Google token response. Note the hour, not Fitbit's eight, and the full scope URL
#: rather than the bare word `weight` — both are load-bearing.
TOKEN_PAYLOAD = {
    "access_token": "access-1",
    "refresh_token": "refresh-1",
    "expires_in": 3600,
    "scope": F.SCOPE,
    "token_type": "Bearer",
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

    def test_the_authorize_url_asks_for_one_read_scope_and_nothing_else(self):
        from urllib.parse import parse_qs, urlparse

        pending = F.begin_authorization("cid", "http://localhost:8000/api/fitbit/callback")
        parsed = urlparse(pending.url)
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == F.AUTHORIZE_URL
        assert parsed.netloc == "accounts.google.com"
        # One scope, read-only. A write scope on an app that never writes is a scope
        # that can only ever leak.
        assert params["scope"] == F.SCOPE
        assert params["scope"].endswith(".health_metrics_and_measurements.readonly")
        assert " " not in params["scope"]
        assert params["response_type"] == "code"
        assert params["code_challenge_method"] == "S256"
        assert params["code_challenge"] == F.code_challenge(pending.verifier)
        assert params["state"] == pending.state
        assert params["redirect_uri"] == "http://localhost:8000/api/fitbit/callback"

    def test_the_authorize_url_asks_for_offline_access(self):
        """Without this Google issues no refresh token and the link dies in an hour."""
        from urllib.parse import parse_qs, urlparse

        pending = F.begin_authorization("cid", "http://x/cb")
        params = {k: v[0] for k, v in parse_qs(urlparse(pending.url).query).items()}
        assert params["access_type"] == "offline"
        assert params["prompt"] == "consent"

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

    # Every real Google code looks like this: `4/0A…`, with a forward slash the address
    # bar shows as `%2F`. Truncating it at the slash is what produces Google's
    # `invalid_grant: Malformed auth code`.
    REAL_CODE = "4/0AVGzR1DkQ_7w-xY2z.p~aBcDeF3"

    def test_keeps_a_percent_encoded_slash_in_a_real_google_code(self):
        url = (
            "http://localhost:8000/api/fitbit/callback"
            "?code=4%2F0AVGzR1DkQ_7w-xY2z.p~aBcDeF3&state=s1"
        )
        assert F.extract_code(url, "s1") == self.REAL_CODE

    def test_keeps_a_literal_slash_in_a_real_google_code(self):
        """FastAPI decodes the query before the callback route sees it."""
        url = f"http://localhost:8000/api/fitbit/callback?code={self.REAL_CODE}&state=s1"
        assert F.extract_code(url, "s1") == self.REAL_CODE

    def test_accepts_a_real_code_pasted_bare(self):
        assert F.extract_code(self.REAL_CODE) == self.REAL_CODE

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
        # Byte-identical to the consent URL's, or Google refuses the exchange.
        assert form["redirect_uri"] == pending.redirect_uri
        assert tokens.access_token == "access-1"
        assert tokens.expires_at == 1000.0 + 3600

    def test_authenticates_the_app_with_the_secret_in_the_body(self):
        """Google's token endpoint takes `client_secret` as a form field.

        Fitbit's took HTTP Basic. Sending Basic to Google returns `invalid_client`,
        which says nothing about which half it disliked — so this asserts the field is
        present *and* that no Authorization header is sent, because a stray one is
        exactly the kind of leftover that still passes a "does it work" check.
        """
        pending = F.begin_authorization("test-client-id", "http://localhost:8000/cb")
        transport = FakeTransport(response(200, TOKEN_PAYLOAD))
        F.exchange_code(CREDS, pending, "code", transport, now=0.0)
        call = transport.calls[0]
        form = transport.form(0)
        assert form["client_secret"] == "test-client-secret"
        assert form["client_id"] == "test-client-id"
        assert "Authorization" not in call["headers"]

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
        transport = FakeTransport(response(200, {"access_token": "a", "expires_in": 3600}))
        with pytest.raises(F.FitbitError, match="cannot be resumed"):
            F.exchange_code(CREDS, pending, "code", transport, now=0.0)

    def test_a_code_exchange_without_a_refresh_token_names_the_likely_cause(self):
        """`access_type=offline` missing is the one way to land here, so say so."""
        pending = F.begin_authorization("cid", "http://x/cb")
        transport = FakeTransport(response(200, {"access_token": "a", "expires_in": 3600}))
        with pytest.raises(F.FitbitError, match="access_type=offline"):
            F.exchange_code(CREDS, pending, "code", transport, now=0.0)


class TestRefreshRotation:
    def test_a_rotated_refresh_token_is_taken(self):
        """Google *may* return a new refresh token. When it does, it wins."""
        tokens = F.Tokens("access-1", "refresh-1", expires_at=0.0)
        transport = FakeTransport(response(200, REFRESHED_PAYLOAD))
        rotated = F.refresh_tokens(CREDS, tokens, transport, now=5000.0)

        assert transport.form(0)["refresh_token"] == "refresh-1"
        assert rotated.refresh_token == "refresh-2"
        assert rotated.access_token == "access-2"
        assert rotated.expires_at == 5000.0 + 3600

    def test_a_refresh_without_a_new_refresh_token_keeps_the_one_it_has(self):
        """**The usual Google response.** Unlike Fitbit, Google normally returns only a
        new access token and the held refresh token stays valid.

        Treating that as an error would break the very first refresh, an hour into the
        first sync — the exact failure the old rotate-always assumption would have
        caused on live data while every test still passed.
        """
        tokens = F.Tokens("access-1", "refresh-1", expires_at=0.0)
        transport = FakeTransport(
            response(200, {"access_token": "access-2", "expires_in": 3600, "scope": F.SCOPE})
        )
        refreshed = F.refresh_tokens(CREDS, tokens, transport, now=5000.0)

        assert refreshed.access_token == "access-2"
        assert refreshed.refresh_token == "refresh-1"
        assert refreshed.expires_at == 5000.0 + 3600

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


class TestSigninLifetime:
    """D9: the app stays in Testing, where Google ends a sign-in 7 days after consent.

    Google does not put that in the token response, so the issue time is recorded at
    consent and carried through every refresh that keeps the same refresh token. That,
    not the last refresh, is what the 7 days count from.
    """

    DAY = 24 * 3600

    def _exchanged(self, now=1000.0, payload=TOKEN_PAYLOAD):
        pending = F.begin_authorization("test-client-id", "http://localhost:8000/cb")
        return F.exchange_code(CREDS, pending, "code", FakeTransport(response(200, payload)),
                               now=now)

    def test_consent_starts_the_seven_days(self):
        tokens = self._exchanged(now=1000.0)
        assert tokens.refresh_issued_at == 1000.0
        assert tokens.signin_expires_at() == 1000.0 + 7 * self.DAY

    def test_a_refresh_that_keeps_the_token_keeps_the_clock(self):
        held = self._exchanged(now=1000.0)
        transport = FakeTransport(response(200, {"access_token": "access-2", "expires_in": 3600}))
        refreshed = F.refresh_tokens(CREDS, held, transport, now=1000.0 + 3 * self.DAY)
        assert refreshed.refresh_issued_at == 1000.0
        assert refreshed.signin_expires_at() == 1000.0 + 7 * self.DAY

    def test_a_rotated_refresh_token_restarts_it(self):
        held = self._exchanged(now=1000.0)
        rotated = F.refresh_tokens(CREDS, held, FakeTransport(response(200, REFRESHED_PAYLOAD)),
                                   now=5000.0)
        assert rotated.refresh_issued_at == 5000.0

    def test_googles_own_figure_wins_when_it_sends_one(self):
        tokens = self._exchanged(
            now=1000.0, payload={**TOKEN_PAYLOAD, "refresh_token_expires_in": 3 * self.DAY}
        )
        assert tokens.signin_expires_at() == 1000.0 + 3 * self.DAY
        transport = FakeTransport(response(200, {"access_token": "access-2", "expires_in": 3600}))
        refreshed = F.refresh_tokens(CREDS, tokens, transport, now=2000.0)
        assert refreshed.signin_expires_at() == 1000.0 + 3 * self.DAY

    def test_it_survives_the_cache(self, tmp_path):
        F.save_tokens(self._exchanged(now=1000.0), tmp_path)
        assert F.load_tokens(tmp_path).signin_expires_at() == 1000.0 + 7 * self.DAY

    def test_a_cache_from_before_this_was_recorded_has_no_expiry(self, tmp_path):
        """The real cache on the volume was written before T32: no guess is made."""
        F.token_file(tmp_path).write_text(json.dumps(
            {"access_token": "a", "refresh_token": "r", "expires_at": 1.0, "scope": "",
             "user_id": ""}))
        assert F.load_tokens(tmp_path).signin_expires_at() is None

    def test_a_refused_refresh_names_the_testing_limit(self):
        """The message this replaces blamed spent codes and rotated tokens, which sent the
        owner looking in the wrong place on the first real expiry, 2026-10-08."""
        expired = {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}
        with pytest.raises(F.NeedsReauthorization) as caught:
            F.refresh_tokens(CREDS, F.Tokens("a", "r", expires_at=0.0),
                             FakeTransport(response(400, expired)), now=0.0)
        message = str(caught.value)
        assert "Token has been expired or revoked" in message
        assert "7 days" in message and "reconnect Google Health in Settings" in message
        assert "code is single-use" not in message

    def test_a_refused_code_still_talks_about_codes(self):
        pending = F.begin_authorization("test-client-id", "http://localhost:8000/cb")
        bad = {"error": "invalid_grant", "error_description": "Malformed auth code."}
        with pytest.raises(F.NeedsReauthorization, match="code is single-use"):
            F.exchange_code(CREDS, pending, "code", FakeTransport(response(400, bad)), now=0.0)


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

    def test_a_minute_is_the_fallback_when_no_header_says(self, tmp_path):
        """Google Health's window is a minute per user, not Fitbit's hour. Waiting an
        hour on a limit that cleared in sixty seconds is a backfill that looks hung."""
        client, _ = a_client(tmp_path, response(429, FITBIT_ERRORS))
        with pytest.raises(F.RateLimited) as caught:
            client.get("/users/me/dataTypes/weight/dataPoints")
        assert caught.value.retry_after_s == 60

    def test_a_standard_retry_after_header_is_honoured(self, tmp_path):
        client, _ = a_client(
            tmp_path, response(429, FITBIT_ERRORS, headers={"Retry-After": "90"})
        )
        with pytest.raises(F.RateLimited) as caught:
            client.get("/users/me/dataTypes/weight/dataPoints")
        assert caught.value.retry_after_s == 90

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
        for name in ("GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET",
                     "FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET"):
            monkeypatch.delenv(name, raising=False)
        assert F.Credentials.configured() is False
        with pytest.raises(F.NotConnected, match="Google Cloud"):
            F.Credentials.from_env()

    def test_environment_credentials_are_read_when_set(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
        monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_SECRET", "csecret")
        assert F.Credentials.configured() is True
        assert F.Credentials.from_env().client_id == "cid"

    def test_the_old_fitbit_names_still_work(self, monkeypatch):
        """An existing `.env` should not stop the app booting after the migration."""
        for name in ("GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET"):
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("FITBIT_CLIENT_ID", "legacy-id")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "legacy-secret")
        assert F.Credentials.configured() is True
        assert F.Credentials.from_env().client_id == "legacy-id"

    def test_the_new_names_win_over_the_old_ones(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "new-id")
        monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_SECRET", "new-secret")
        monkeypatch.setenv("FITBIT_CLIENT_ID", "legacy-id")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "legacy-secret")
        assert F.Credentials.from_env().client_id == "new-id"


class TestRequestShape:
    def test_no_accept_language_is_sent(self, tmp_path):
        """The old API answered in whatever unit the locale implied, so the header was
        load-bearing. Google Health answers in `weightGrams` and the question is gone —
        sending a locale hint now would only suggest units are still negotiable."""
        client, transport = a_client(tmp_path, response(200, {"dataPoints": []}))
        client.get("/users/me/dataTypes/weight/dataPoints")
        assert "Accept-Language" not in transport.calls[0]["headers"]

    def test_a_relative_path_is_resolved_against_the_api_root(self, tmp_path):
        client, transport = a_client(tmp_path, response(200, {}))
        client.get("users/me/identity")
        assert transport.calls[0]["url"] == "https://health.googleapis.com/v4/users/me/identity"

    def test_the_display_name_is_the_health_user_id(self, tmp_path):
        client, _ = a_client(
            tmp_path,
            response(200, {"legacyUserId": "A1B2C3", "healthUserId": "111111256096816351"}),
        )
        assert client.display_name() == "111111256096816351"

    def test_identity_returns_both_ids(self, tmp_path):
        """Google's migration guide: store both, so rows keyed by the old six-character
        Fitbit id can still be matched to this account after the cutover."""
        client, _ = a_client(
            tmp_path,
            response(200, {"legacyUserId": "A1B2C3", "healthUserId": "111111256096816351"}),
        )
        identity = client.identity()
        assert identity["legacyUserId"] == "A1B2C3"
        assert identity["healthUserId"] == "111111256096816351"


class TestProfileAndConsent:
    def test_a_412_is_its_own_state_with_the_remedy_in_it(self, tmp_path):
        """Consent succeeded; the account has no Google Health profile. The docs require
        an actionable prompt, not a generic error."""
        client, _ = a_client(tmp_path, response(412, {"error": {"code": 412}}))
        with pytest.raises(F.ProfileNotReady) as caught:
            client.get("/users/me/identity")
        assert "Google Health app" in str(caught.value)

    def test_a_403_reads_as_a_withheld_permission(self, tmp_path):
        client, _ = a_client(tmp_path, response(403, {"error": {"message": "denied"}}))
        with pytest.raises(F.MissingConsent):
            client.get("/users/me/dataTypes/weight/dataPoints")

    def test_zero_consent_is_caught_before_it_is_called_a_connection(self):
        """Google issues a token even when the user unticks the permission."""
        tokens = F.Tokens("a", "r", expires_at=0.0, scope="openid email")
        with pytest.raises(F.MissingConsent, match="at least one|At least one"):
            F.require_consent(tokens)

    def test_a_granted_health_scope_passes(self):
        tokens = F.Tokens("a", "r", expires_at=0.0, scope=f"openid {F.SCOPE}")
        F.require_consent(tokens)
        assert F.granted_health_scopes(tokens.scope) == {F.SCOPE}


class TestPaging:
    def test_it_follows_the_cursor_to_the_end(self, tmp_path):
        client, transport = a_client(
            tmp_path,
            response(200, {"dataPoints": [{"weight": {"weightGrams": 1}}], "nextPageToken": "p2"}),
            response(200, {"dataPoints": [{"weight": {"weightGrams": 2}}], "nextPageToken": ""}),
        )
        points = client.data_points("weight")
        assert len(points) == 2
        assert "pageToken=p2" in transport.calls[1]["url"]

    def test_a_repeated_cursor_stops_rather_than_looping_forever(self, tmp_path):
        """A server that echoes the same token would otherwise hang the sync."""
        client, transport = a_client(
            tmp_path,
            *[response(200, {"dataPoints": [], "nextPageToken": "same"})] * 4,
        )
        client.data_points("weight")
        assert len(transport.calls) == 2

    def test_the_filter_is_passed_through(self, tmp_path):
        client, transport = a_client(tmp_path, response(200, {"dataPoints": []}))
        client.data_points("body-fat", 'body_fat.sample_time.physical_time >= "2026-01-01T00:00:00Z"')
        url = transport.calls[0]["url"]
        assert "dataTypes/body-fat/dataPoints" in url
        assert "body_fat.sample_time.physical_time" in url
