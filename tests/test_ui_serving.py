"""Serving the React build: the SPA fallback, its assets, and the edges around them.

The build itself is a stand-in (`fake_ui` in conftest), so these pin the server's
behaviour, not whatever `npm run build` last produced on this machine.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.api.server import create_app


@pytest.fixture
def ui_client(settings, fake_ui):
    return TestClient(create_app(replace(settings, ui_dir=fake_ui)), follow_redirects=False)


def _is_index(res) -> bool:
    return res.status_code == 200 and "data-spa-index" in res.text


class TestBuiltUi:
    @pytest.mark.parametrize("path", ["/", "/activities", "/activities/123",
                                      "/login", "/some/deep/client/route"])
    def test_client_routes_get_index_html(self, ui_client, path):
        res = ui_client.get(path)
        assert _is_index(res)
        assert res.headers["content-type"].startswith("text/html")

    def test_index_is_revalidated_so_a_rebuild_is_picked_up(self, ui_client):
        assert ui_client.get("/activities").headers["cache-control"] == "no-cache"

    def test_hashed_assets_are_served(self, ui_client):
        res = ui_client.get("/assets/index-abc123.js")
        assert res.status_code == 200
        assert res.text == "console.log('spa');"
        assert "javascript" in res.headers["content-type"]

    def test_a_big_asset_is_compressed(self, settings, fake_ui):
        """T13: without this the browser is sent 1.2 MB of JavaScript however
        politely it asked for gzip, and the SPA's first load is 3x what it needs
        to be. `StaticFiles` does not compress; the middleware does."""
        big = "console.log('spa');" + "// padding\n" * 500
        (fake_ui / "assets" / "index-big000.js").write_text(big)
        client = TestClient(create_app(replace(settings, ui_dir=fake_ui)))

        res = client.get("/assets/index-big000.js", headers={"accept-encoding": "gzip"})
        assert res.headers["content-encoding"] == "gzip"
        # httpx decodes it; what matters is that the bytes on the wire were fewer.
        assert res.text == big
        assert int(res.headers["content-length"]) < len(big) / 2

    def test_a_small_reply_is_left_alone(self, ui_client):
        """Below the minimum the CPU costs more than the bytes save."""
        res = ui_client.get("/assets/index-abc123.js", headers={"accept-encoding": "gzip"})
        assert "content-encoding" not in res.headers

    def test_a_missing_asset_is_a_404_not_index_html(self, ui_client):
        """HTML under a .js name is a blank page with a MIME error in the console."""
        res = ui_client.get("/assets/gone-999.js")
        assert res.status_code == 404
        assert "data-spa-index" not in res.text

    def test_top_level_build_files_are_served_as_themselves(self, ui_client):
        res = ui_client.get("/favicon.svg")
        assert res.status_code == 200
        assert res.text.startswith("<svg")

    @pytest.mark.parametrize("path", ["/api/unknown", "/api/activities/1/nope", "/api"])
    def test_an_unknown_api_path_is_a_json_404(self, ui_client, path):
        res = ui_client.get(path)
        assert res.status_code == 404
        assert res.headers["content-type"] == "application/json"
        assert res.json() == {"detail": "Not Found"}

    def test_api_method_semantics_are_untouched(self, ui_client):
        """The fallback is a 404 handler, not a route, so it cannot mask a 405."""
        assert ui_client.get("/api/sync/start").status_code == 405
        assert ui_client.post("/api/unknown").status_code == 404

    def test_api_routes_and_docs_still_win(self, ui_client):
        assert ui_client.get("/api/health").json()["status"] == "ok"
        assert ui_client.get("/openapi.json").json()["info"]["title"] == "Garmin Analytics"
        assert "swagger" in ui_client.get("/docs").text.lower()

    def test_the_fallback_is_not_in_the_openapi_spec(self, ui_client):
        paths = ui_client.get("/openapi.json").json()["paths"]
        assert all(p.startswith("/api/") for p in paths)

    @pytest.mark.parametrize("path", [
        "/..%2f..%2fetc/passwd",
        "/..%2F..%2F..%2F..%2Fetc%2Fpasswd",
        "/%2e%2e/%2e%2e/etc/passwd",
        "/..",
        "/assets/..%2f..%2findex.html",
        "/assets/..%2f..%2f..%2fetc/passwd",
    ])
    def test_path_traversal_cannot_leave_the_build(self, ui_client, path):
        res = ui_client.get(path)
        assert "root:" not in res.text
        assert res.status_code in (200, 404)
        if res.status_code == 200:
            assert _is_index(res)

    def test_a_file_just_outside_the_build_is_not_reachable(self, settings, fake_ui):
        (fake_ui.parent / "secret.txt").write_text("TOP-SECRET")
        client = TestClient(create_app(replace(settings, ui_dir=fake_ui)))
        for path in ("/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/assets/..%2f..%2fsecret.txt"):
            assert "TOP-SECRET" not in client.get(path).text

    def test_a_symlink_out_of_the_build_is_not_followed(self, settings, fake_ui):
        (fake_ui.parent / "secret.txt").write_text("TOP-SECRET")
        (fake_ui / "leak.txt").symlink_to(fake_ui.parent / "secret.txt")
        client = TestClient(create_app(replace(settings, ui_dir=fake_ui)))
        res = client.get("/leak.txt")
        assert "TOP-SECRET" not in res.text
        assert _is_index(res)


class TestUnbuiltUi:
    @pytest.fixture
    def bare_client(self, settings, tmp_path):
        return TestClient(create_app(replace(settings, ui_dir=tmp_path / "never-built")))

    @pytest.mark.parametrize("path", ["/", "/activities/123", "/login", "/favicon.svg"])
    def test_pages_say_how_to_build_the_ui(self, bare_client, path):
        res = bare_client.get(path)
        assert res.status_code == 503
        assert res.headers["content-type"].startswith("text/plain")
        assert "npm run build" in res.text and "frontend/" in res.text

    def test_the_api_works_without_the_ui(self, bare_client):
        assert bare_client.get("/api/health").status_code == 200
        assert bare_client.get("/api/unknown").status_code == 404
        assert bare_client.get("/assets/index-abc123.js").status_code == 404


class TestGatedUi:
    @pytest.fixture
    def gated(self, settings, fake_ui):
        from garmin_analytics.db.store import Store

        Store.open(settings).close()
        app = create_app(replace(settings, app_password="gate-password-ui", ui_dir=fake_ui))
        return TestClient(app, follow_redirects=False)

    @pytest.mark.parametrize("path", ["/", "/activities", "/activities/123"])
    def test_an_unauthenticated_page_redirects_to_login(self, gated, path):
        res = gated.get(path)
        assert res.status_code == 302
        assert res.headers["location"] == "/login"

    def test_the_login_screen_and_its_assets_are_public(self, gated):
        assert _is_index(gated.get("/login"))
        assert gated.get("/assets/index-abc123.js").status_code == 200
        assert gated.get("/favicon.svg").status_code == 200

    def test_the_api_is_still_401_not_a_redirect(self, gated):
        assert gated.get("/api/summary").status_code == 401

    def test_a_session_opens_the_client_routes(self, gated):
        gated.post("/api/auth/login", json={"password": "gate-password-ui"})
        assert _is_index(gated.get("/activities/123"))
