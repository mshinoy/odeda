"""The OpenAPI document `npm run gen:api` reads.

It used to be fetched from whatever answered on port 8000, which on the owner's machine
is the running container. Regenerating from a branch that added an endpoint therefore
described the *deployed* build and deleted the types the branch had added — a failure
that showed up as frontend type errors pointing at the wrong place.
"""

from __future__ import annotations

import json
import subprocess
import sys

from garmin_analytics.api import openapi as openapi_mod


class TestItDescribesThisCheckout:
    def test_a_route_this_code_defines_is_in_it(self):
        """The property the old generator could not promise."""
        spec = openapi_mod.build()
        assert "/api/plan/start" in spec["paths"]

    def test_a_field_this_code_defines_is_in_it(self):
        spec = openapi_mod.build()
        week = spec["components"]["schemas"]["PlanWeek"]["properties"]
        assert "sessions_prescribed" in week

    def test_every_api_route_registered_is_described(self):
        from garmin_analytics.api.openapi import build

        spec = build()
        described = set(spec["paths"])
        assert len(described) > 50
        for path in ("/api/plan", "/api/activities", "/api/race"):
            assert path in described


class TestItIsSafeToRun:
    def test_it_does_not_touch_the_real_database(self, settings, store):
        """Generating a schema must not read, create or migrate anyone's data. The
        store fixture's database is the one that would be hit if it did."""
        before = settings.db_path.stat().st_mtime_ns
        openapi_mod.build()
        assert settings.db_path.stat().st_mtime_ns == before

    def test_it_leaves_the_environment_as_it_found_it(self, settings):
        """It points GA_* at a directory it then deletes. Leaving the process pointed
        there would hand a dead path to the next `load_settings()`, which the tests hit
        because they import this module instead of shelling out."""
        import os

        from garmin_analytics.config import load_settings

        before = {k: os.environ.get(k) for k in ("GA_DATA_DIR", "GA_DB", "GA_RAW_DIR")}
        openapi_mod.build()
        assert {k: os.environ.get(k) for k in before} == before
        assert load_settings().db_path == settings.db_path

    def test_it_runs_as_a_module_and_prints_json(self):
        """How `gen-api.mjs` actually calls it."""
        result = subprocess.run(
            [sys.executable, "-m", "garmin_analytics.api.openapi"],
            capture_output=True,
            text=True,
            timeout=180,
        )
        assert result.returncode == 0, result.stderr
        spec = json.loads(result.stdout)
        assert spec["openapi"].startswith("3.")
        assert "/api/plan/start" in spec["paths"]

    def test_nothing_but_json_goes_to_stdout(self):
        """It is piped into a types generator; a stray print would corrupt it."""
        result = subprocess.run(
            [sys.executable, "-m", "garmin_analytics.api.openapi"],
            capture_output=True,
            text=True,
            timeout=180,
        )
        json.loads(result.stdout)  # raises if anything else was written
