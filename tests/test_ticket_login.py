"""Browser-ticket login: the path that still works after Garmin retired mobile SSO.

Garmin's password endpoint (`sso.garmin.com/mobile/api/login`) now answers 429 to
every caller, for accounts that do not exist as readily as for accounts that do —
which is why garth was deprecated (matin/garth#222). Their web sign-in sets cookies
from JavaScript, so a browser has to do that part; what it hands back is a CAS service
ticket, and exchanging a ticket for OAuth tokens is a plain API call that still works,
verified against Garmin on 2026-09-23 (an invalid ticket is answered 401, not 429).

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


class TestLoginWithTicket:
    """The exchange itself is stubbed — the real one needs a live single-use ticket."""

    def test_saves_the_token_cache_with_private_modes(self, tmp_path, monkeypatch):
        token_dir = tmp_path / "tokens"
        saved: dict[str, str] = {}

        class FakeClient:
            profile = {"displayName": "shinoy"}

            def configure(self, **kw):
                saved["configured"] = sorted(kw)

            def dump(self, path, /, oauth2_only=False):
                pass

        fake_garth = type("G", (), {
            "client": FakeClient(),
            "save": staticmethod(
                lambda p: (Path(p) / "oauth1_token.json").write_text(json.dumps({"t": 1}))
            ),
        })()
        monkeypatch.setattr(connect, "_garth", lambda: fake_garth)
        monkeypatch.setattr("garth.sso.get_oauth1_token", lambda ticket, client: "oauth1")
        monkeypatch.setattr("garth.sso.exchange", lambda oauth1, client: "oauth2")

        name = connect.login_with_ticket("ST-5-abc-cas", token_dir)

        assert name == "shinoy"
        assert saved["configured"] == ["oauth1_token", "oauth2_token"]
        assert (token_dir.stat().st_mode & 0o777) == 0o700
        assert (token_dir / "oauth1_token.json").stat().st_mode & 0o777 == 0o600

    def test_a_rejected_ticket_explains_that_tickets_are_single_use(
        self, tmp_path, monkeypatch
    ):
        def boom(ticket, client):
            raise RuntimeError("401 Client Error: Unauthorized")

        monkeypatch.setattr(connect, "_garth", lambda: type("G", (), {"client": object()})())
        monkeypatch.setattr("garth.sso.get_oauth1_token", boom)

        with pytest.raises(connect.ConnectError) as exc:
            connect.login_with_ticket("ST-5-abc-cas", tmp_path / "tokens")
        message = str(exc.value)
        assert "single-use" in message and "sign in again" in message
        assert "401" in message, "keep Garmin's own words; guessing hides the real cause"


class TestSigninUrl:
    def test_is_the_web_flow_not_the_retired_mobile_one(self):
        assert connect.SIGNIN_URL.startswith("https://sso.garmin.com/sso/signin")
        assert "mobile/api/login" not in connect.SIGNIN_URL

    def test_asks_for_the_embed_widget_so_the_ticket_lands_in_the_address_bar(self):
        assert "embedWidget=true" in connect.SIGNIN_URL
        assert "service=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed" in connect.SIGNIN_URL
