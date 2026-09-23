"""Browser-ticket login: the sign-in route that depends on no scripted login at all.

The password login is expected to work — `garminconnect` cascades through five
strategies — but every one of them is Garmin's edge deciding a script looks acceptable,
and that decision has changed twice already. A real browser signing in does not depend
on it. What the browser hands back is a CAS service ticket, and exchanging a ticket for
tokens is a plain API call (verified against Garmin on 2026-09-23: an invalid ticket is
answered 401, not 429).

These tests pin the half we own: getting the ticket out of whatever the user pasted,
saving the cache with the right modes, and failing in a way that says what to do next.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from garmin_analytics.ingest import connect


class TestExtractTicket:
    def test_accepts_the_whole_redirect_url(self):
        url = "https://sso.garmin.com/sso/embed?ticket=ST-1234-abcDEF-cas"
        assert connect.extract_ticket(url) == "ST-1234-abcDEF-cas"

    def test_accepts_a_bare_ticket_with_stray_whitespace(self):
        assert connect.extract_ticket("  ST-99-x_y.z-cas \n") == "ST-99-x_y.z-cas"

    def test_accepts_a_url_with_other_query_parameters(self):
        url = "https://sso.garmin.com/sso/embed?foo=1&ticket=ST-7-aa-cas&bar=2"
        assert connect.extract_ticket(url) == "ST-7-aa-cas"

    @pytest.mark.parametrize("junk", ["", "   ", "no ticket here", "https://sso.garmin.com/sso/embed"])
    def test_rejects_anything_without_a_ticket(self, junk):
        with pytest.raises(connect.ConnectError) as exc:
            connect.extract_ticket(junk)
        assert "ticket=ST-" in str(exc.value), "the error must show the shape to look for"

    def test_a_mispaste_is_a_bad_request_not_an_upstream_failure(self):
        """It reaches the API as 400. Answering 502 would tell someone who pasted the
        wrong thing that Garmin is broken, and send them to wait it out."""
        with pytest.raises(ValueError):
            connect.extract_ticket("no ticket here")


class FakeInner:
    """Stands in for `garminconnect`'s Client: the ticket exchange needs a live
    single-use ticket, so the network half is the part that gets faked."""

    def __init__(self, on_ticket=None):
        self.on_ticket = on_ticket
        self.tickets: list[str] = []
        self.dumped: list[str] = []

    def _establish_session(self, ticket, sess=None, service_url=None):
        self.tickets.append(ticket)
        if self.on_ticket:
            self.on_ticket(ticket)

    def dump(self, path):
        self.dumped.append(path)
        target = Path(path) / connect.TOKEN_FILENAME
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"di_token": "x"}))


class FakeGarmin:
    def __init__(self, inner, display_name="shinoy"):
        self.client = inner
        self.display_name = display_name


@pytest.fixture(autouse=True)
def no_leaked_client():
    """Every test starts and ends without a live session on the module."""
    connect._set_client(None)
    yield
    connect._set_client(None)


class TestLoginWithTicket:
    def test_saves_the_token_cache_with_private_modes(self, tmp_path, monkeypatch):
        token_dir = tmp_path / "tokens"
        inner = FakeInner()
        monkeypatch.setattr(connect, "_new_client", lambda **kw: FakeGarmin(inner))

        name = connect.login_with_ticket("ST-5-abc-cas", token_dir)

        assert name == "shinoy"
        assert inner.tickets == ["ST-5-abc-cas"]
        assert (token_dir.stat().st_mode & 0o777) == 0o700
        assert (token_dir / connect.TOKEN_FILENAME).stat().st_mode & 0o777 == 0o600

    def test_the_session_is_left_usable_for_the_sync_that_follows(
        self, tmp_path, monkeypatch
    ):
        """Signing in and then being told to sign in again is the whole failure this
        flow exists to avoid."""
        inner = FakeInner()
        client = FakeGarmin(inner)
        monkeypatch.setattr(connect, "_new_client", lambda **kw: client)

        connect.login_with_ticket("ST-5-abc-cas", tmp_path / "tokens")

        assert connect._client() is client

    def test_a_rejected_ticket_explains_that_tickets_are_single_use(
        self, tmp_path, monkeypatch
    ):
        def boom(ticket):
            raise RuntimeError("401 Client Error: Unauthorized")

        monkeypatch.setattr(
            connect, "_new_client", lambda **kw: FakeGarmin(FakeInner(on_ticket=boom))
        )

        with pytest.raises(connect.ConnectError) as exc:
            connect.login_with_ticket("ST-5-abc-cas", tmp_path / "tokens")
        message = str(exc.value)
        assert "single-use" in message and "sign in again" in message
        assert "401" in message, "keep Garmin's own words; guessing hides the real cause"

    def test_a_library_that_drops_ticket_support_says_so(self, tmp_path, monkeypatch):
        """`_establish_session` is the one internal this module reaches for. If an
        upgrade moves it, the error has to name the way out, not raise AttributeError."""

        class NoTickets:
            pass

        monkeypatch.setattr(connect, "_new_client", lambda **kw: FakeGarmin(NoTickets()))

        with pytest.raises(connect.ConnectError) as exc:
            connect.login_with_ticket("ST-5-abc-cas", tmp_path / "tokens")
        assert "password" in str(exc.value)


class TestSigninUrl:
    def test_is_the_web_flow_not_the_retired_mobile_one(self):
        assert connect.SIGNIN_URL.startswith("https://sso.garmin.com/sso/signin")
        assert "mobile/api/login" not in connect.SIGNIN_URL

    def test_asks_for_the_embed_widget_so_the_ticket_lands_in_the_address_bar(self):
        assert "embedWidget=true" in connect.SIGNIN_URL
        assert "service=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed" in connect.SIGNIN_URL
