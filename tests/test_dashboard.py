"""The dashboard: offline-safety, the page/JS contract, and a real headless render.

Three layers, weakest to strongest:

1. Static checks — no CDN anywhere, every asset referenced is one we ship.
2. Contract checks — every element id `app.js` reaches for exists in `index.html`, and
   every `/api/...` path it fetches is a real route that returns 200 on seeded data.
   This is the "DOM/JS-bootstrap assertion" layer: it proves the data path, not pixels.
3. A genuine headless Chromium render, if Chromium is installed (it is on this machine,
   so no browser stack was downloaded for it). It boots the page against a live uvicorn,
   dumps the post-JavaScript DOM and asserts that uPlot actually drew canvases and that
   the readiness figure carries a number. Skipped, not failed, where Chromium is absent.
"""

from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.api.server import create_app

WEB = Path(__file__).resolve().parents[1] / "garmin_analytics" / "web"
INDEX = (WEB / "index.html").read_text()
APP_JS = (WEB / "app.js").read_text()
STYLE = (WEB / "style.css").read_text()


@pytest.fixture
def client(seeded_db):
    return TestClient(create_app(seeded_db))


class TestOffline:
    @pytest.mark.parametrize("source, name", [(INDEX, "index.html"), (APP_JS, "app.js"),
                                              (STYLE, "style.css")])
    def test_no_external_urls(self, source, name):
        """Non-negotiable #4: the dashboard works with no network at all."""
        external = re.findall(r"""["'(](https?:)?//[^"')\s]+""", source)
        assert external == [], f"{name} references something off-machine: {external}"

    def test_no_cdn_hostnames(self):
        """Hostnames in URL position only — the footer is allowed to say 'no CDN'."""
        blob = (INDEX + APP_JS + STYLE).lower()
        for host in ("//cdn.", "unpkg.com", "jsdelivr", "googleapis.com", "cloudflare.com",
                     "bootstrapcdn"):
            assert host not in blob

    def test_every_referenced_asset_is_shipped(self):
        for ref in re.findall(r'(?:src|href)="(/static/[^"]+)"', INDEX):
            assert (WEB / ref[len("/static/"):]).exists(), f"missing asset {ref}"

    def test_vendored_uplot_is_present_with_its_licence(self):
        assert (WEB / "vendor" / "uPlot.iife.min.js").stat().st_size > 20_000
        assert (WEB / "vendor" / "uPlot.min.css").exists()
        licence = (WEB / "vendor" / "uPlot.LICENSE").read_text()
        assert "MIT" in licence

    def test_no_inline_remote_font(self):
        assert "@font-face" not in STYLE
        assert "fonts.g" not in INDEX.lower()


class TestPageStructure:
    def test_all_six_tabs_exist(self, client):
        html = client.get("/").text
        for panel in ("overview", "load", "recovery", "activities", "performance", "race"):
            assert f'data-panel="{panel}"' in html
            assert f'id="panel-{panel}"' in html

    def test_scripts_load_uplot_before_the_app(self, client):
        html = client.get("/").text
        assert html.index("uPlot.iife.min.js") < html.index("app.js")

    def test_synthetic_banner_markup_exists(self, client):
        assert 'id="synthetic-banner"' in client.get("/").text

    def test_drawer_markup_exists(self, client):
        html = client.get("/").text
        assert 'id="drawer"' in html and 'id="drawer-backdrop"' in html

    def test_activity_filters_exist(self, client):
        html = client.get("/").text
        for element in ("filter-type", "filter-q", "filter-from", "filter-to", "filter-clear",
                        "page-prev", "page-next"):
            assert f'id="{element}"' in html

    def test_honest_limits_are_stated_on_the_page(self, client):
        """The footer has to say what this is, not just look tidy."""
        html = client.get("/").text
        assert "no public API" in html
        assert "unofficial" in html

    def test_the_browser_signin_fallback_is_reachable_from_settings(self, client):
        """Garmin refuses the scripted login from some hosts outright, and on those
        this is the only way in. An error message pointing at an API endpoint is not a
        way in for someone using the web UI."""
        html = client.get("/").text
        for element in ("garmin-signin-url", "garmin-ticket", "garmin-ticket-submit"):
            assert f'id="{element}"' in html


class TestJsContract:
    """Every id app.js reaches for must exist, and every endpoint it calls must work."""

    def _ids_in_index(self):
        return set(re.findall(r'id="([a-zA-Z0-9_-]+)"', INDEX))

    def _chart_ids_in_js(self):
        """Every 'chart-…' literal in app.js.

        Matching `mount('…')` alone misses the ids passed through helpers such as
        `pair()`, which is exactly the case a container-orphan check has to catch.
        """
        return set(re.findall(r"""['"](chart-[a-z0-9-]+)['"]""", APP_JS))

    def test_every_mounted_chart_container_exists(self):
        mounted = self._chart_ids_in_js()
        assert len(mounted) >= 12, "expected a chart-rich dashboard"
        missing = mounted - self._ids_in_index()
        assert not missing, f"app.js mounts charts with no container: {sorted(missing)}"

    def test_every_selector_lookup_resolves(self):
        selected = set(re.findall(r"""\$\('#([a-zA-Z0-9_-]+)'""", APP_JS))
        # ids created dynamically inside the activity drawer are not in index.html
        dynamic = {"drawer-hr", "drawer-pace"}
        missing = selected - self._ids_in_index() - dynamic
        assert not missing, f"app.js looks up ids that do not exist: {sorted(missing)}"

    def test_every_declared_container_is_used(self):
        """No orphan chart divs left behind by an edit."""
        declared = {i for i in self._ids_in_index() if i.startswith("chart-")}
        used = self._chart_ids_in_js()
        assert not (declared - used), f"unused chart containers: {sorted(declared - used)}"

    def _api_paths(self):
        paths = set(re.findall(r"""api\(['"`](/api/[^'"`?]+)""", APP_JS))
        paths |= set(re.findall(r"""api\(['"`](/api/[^'"`?]+)\?""", APP_JS))
        return paths

    def test_the_api_calls_app_js_makes_are_real_routes(self, client):
        paths = self._api_paths()
        assert "/api/summary" in paths and "/api/race" in paths
        for path in sorted(paths):
            if "${" in path or "encodeURIComponent" in path:
                continue
            res = client.get(path)
            assert res.status_code == 200, f"{path} → {res.status_code}"
            assert res.json(), f"{path} returned an empty body"

    def test_the_templated_activity_routes_resolve(self, client):
        aid = client.get("/api/activities?limit=1").json()["rows"][0]["activity_id"]
        assert client.get(f"/api/activities/{aid}").status_code == 200
        assert client.get(f"/api/raw/activities/{aid}").status_code == 200

    def test_colours_come_from_css_variables_not_literals(self):
        """One palette, in one place. A hex in app.js is a colour that cannot be re-themed."""
        hexes = re.findall(r"#[0-9a-fA-F]{6}\b", APP_JS)
        assert hexes == [], f"app.js hard-codes colours: {set(hexes)}"

    def test_every_series_colour_role_is_defined_in_css(self):
        roles = set(re.findall(r"C\['(series-\d|good|warning|critical|serious)'\]", APP_JS))
        for role in roles:
            assert f"--{role}:" in STYLE, f"app.js uses --{role} but style.css does not define it"

    def test_js_parses(self):
        """Cheap syntax gate: node is present, so use it."""
        node = shutil.which("node")
        if not node:
            pytest.skip("node not installed")
        out = subprocess.run([node, "--check", str(WEB / "app.js")],
                             capture_output=True, text=True)
        assert out.returncode == 0, out.stderr


# ---------------------------------------------------------------------------
# Real browser
# ---------------------------------------------------------------------------

CHROME = next(
    (p for p in ("chromium-browser", "chromium", "google-chrome", "google-chrome-stable")
     if shutil.which(p)),
    None,
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def live_server(request):
    """A real uvicorn against the shared seeded database."""
    seeded = request.getfixturevalue("seeded_db")
    port = _free_port()
    env = {**os.environ,
           "GA_DB": str(seeded.db_path),
           "GA_DATA_DIR": str(seeded.data_dir),
           "PYTHONWARNINGS": "ignore"}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "--factory",
         "garmin_analytics.api.server:create_app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        import urllib.error
        import urllib.request

        for _ in range(100):
            try:
                urllib.request.urlopen(url + "/api/health", timeout=1)
                break
            except (urllib.error.URLError, OSError):
                time.sleep(0.2)
        else:
            proc.kill()
            pytest.fail("uvicorn did not come up")
        yield url
    finally:
        proc.terminate()
        proc.wait(timeout=10)


@pytest.mark.skipif(CHROME is None, reason="no Chromium on this machine")
class TestHeadlessRender:
    """Proof that the page really renders — not a promise that it should.

    Chromium was already installed here; nothing was downloaded to run these.
    """

    # Booting Chromium costs a few seconds, so each URL is rendered once per session.
    _dom_cache: dict[str, str] = {}

    def _dump_dom(self, url: str, require: str = 'data-ready="1"') -> str:
        """Render `url` and return the DOM once `require` is present.

        The virtual-time budget bounds *virtual* time, but the fetches app.js waits
        on are real: under a loaded machine (the full suite runs a live server and
        667 other tests) a single dump can return before the page has settled.
        So retry with a growing budget, and only cache a settled DOM.
        """
        if url in self._dom_cache:
            return self._dom_cache[url]

        dom = ""
        for budget in (9000, 20000, 40000):
            out = subprocess.run(
                [CHROME, "--headless", "--disable-gpu", "--no-sandbox",
                 f"--virtual-time-budget={budget}", "--dump-dom", url],
                capture_output=True, text=True, timeout=180,
            )
            dom = out.stdout
            if require in dom:
                self._dom_cache[url] = dom
                return dom
        # Never settled. Return the last attempt so the assertion reports the real
        # failure rather than a timeout from here.
        return dom

    def test_overview_bootstraps_and_draws(self, live_server):
        dom = self._dump_dom(live_server + "/#overview")
        # app.js sets this only after /api/health has resolved.
        assert 'data-ready="1"' in dom, "the JS never finished booting"
        assert "<canvas" in dom, "uPlot drew no canvas"
        assert "uplot" in dom.lower()

    def test_readiness_hero_carries_a_real_number(self, live_server):
        dom = self._dump_dom(live_server + "/#overview")
        match = re.search(r'class="figure">(\d+)<', dom)
        assert match, "no readiness figure rendered"
        assert 0 <= int(match.group(1)) <= 100

    def test_no_error_banner_after_load(self, live_server):
        dom = self._dump_dom(live_server + "/#overview")
        assert 'class="banner error show"' not in dom

    def test_synthetic_banner_is_shown_for_seeded_data(self, live_server):
        dom = self._dump_dom(live_server + "/#overview")
        assert 'class="banner synthetic show"' in dom

    def test_training_load_tab_draws_three_charts(self, live_server):
        dom = self._dump_dom(live_server + "/#load")
        assert dom.count("<canvas") >= 3
        assert "FITNESS AND FATIGUE" in dom.upper()

    def test_activities_tab_renders_table_rows(self, live_server):
        dom = self._dump_dom(live_server + "/#activities")
        assert dom.count("<tr") > 10
        assert "activities</span>" in dom or "activities" in dom

    def test_race_tab_renders_the_countdown(self, live_server):
        dom = self._dump_dom(live_server + "/#race")
        assert "days to go" in dom
        assert "Doha Marathon" in dom

    def test_activity_drawer_opens_from_a_deep_link(self, live_server):
        """`#activities/<id>` opens the detail drawer — which also makes it testable."""
        import json
        import urllib.request

        with urllib.request.urlopen(
            live_server + "/api/activities?limit=1&type=running"
        ) as fh:
            aid = json.load(fh)["rows"][0]["activity_id"]

        # The drawer fills from its own fetch, which resolves after the page is
        # otherwise ready — so settle on drawer content, not just the boot flag.
        dom = self._dump_dom(
            f"{live_server}/#activities/{aid}", require="Best efforts in this activity"
        )
        assert 'id="drawer"' in dom
        assert "drawer" in dom and 'hidden=""' not in dom.split('id="drawer"')[1][:60]
        assert "Time in heart-rate zones" in dom
        assert "Kilometre splits" in dom
        assert "Best efforts in this activity" in dom
        # two per-activity charts (HR and pace), on their own scales, never dual-axis
        assert dom.count("<canvas") >= 2
