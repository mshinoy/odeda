"""The state every new user starts in: schema created, not one row synced.

`report` crashed here with `KeyError: 'band'` — the no-data branch of
`compute_readiness` returned a dict missing the keys its callers index. The
analytics layer itself was fine on an empty database; the shape contract
between it and its consumers was not. These tests pin the contract.
"""

from __future__ import annotations

import pytest

from garmin_analytics.analytics import readiness as ready_mod
from garmin_analytics.db.store import Store


@pytest.fixture
def empty_store(settings):
    st = Store.open(settings)       # creates the schema, inserts nothing
    yield st
    st.close()


class TestReadinessShapeContract:
    def test_empty_and_populated_return_the_same_keys(self, empty_store, seeded_store):
        """The no-data branch is a different code path; it must not be a different shape."""
        empty = ready_mod.compute_readiness(empty_store)
        populated = ready_mod.compute_readiness(seeded_store)
        assert set(empty) == set(populated), (
            "empty-database readiness is missing: "
            f"{sorted(set(populated) - set(empty))}"
        )

    def test_empty_values_are_empty_not_absent(self, empty_store):
        rd = ready_mod.compute_readiness(empty_store)
        assert rd["day"] is None
        assert rd["score"] is None
        assert rd["band"] is None
        assert rd["components"] == {}
        assert rd["flags"] == []
        assert rd["reasons"]                      # something to show the user
        assert isinstance(rd["recommendation"], str) and rd["recommendation"]

    def test_the_keys_the_cli_indexes_are_all_present(self, empty_store):
        """cmd_report indexes these directly — absence is a traceback, not a blank."""
        rd = ready_mod.compute_readiness(empty_store)
        for key in ("day", "score", "band", "reasons", "recommendation"):
            assert key in rd, f"cmd_report would crash on rd[{key!r}]"


class TestCliOnAFreshInstall:
    def test_report_exits_clean_with_no_data(self, settings, capsys):
        from garmin_analytics.cli import main

        Store.open(settings).close()              # schema only
        assert main(["report"]) == 0
        out = capsys.readouterr().out
        assert "No data yet." in out
        assert "None" not in out, "placeholder Nones read as a broken install"
        # and it points somewhere useful rather than dead-ending
        assert "login" in out and "seed" in out

    def test_the_commands_the_empty_report_suggests_all_exist(self, settings, capsys):
        """A hint that names a non-existent flag is worse than no hint."""
        import re

        from garmin_analytics.cli import build_parser

        Store.open(settings).close()
        main_mod = __import__("garmin_analytics.cli", fromlist=["main"])
        assert main_mod.main(["report"]) == 0
        out = capsys.readouterr().out

        suggested = re.findall(r"garmin-analytics ([a-z-]+)", out)
        assert suggested
        known = set(build_parser()._subparsers._group_actions[0].choices)
        for command in suggested:
            assert command in known, f"report suggests `{command}`, which does not exist"

    def test_report_json_exits_clean_with_no_data(self, settings, capsys):
        from garmin_analytics.cli import main

        import json

        Store.open(settings).close()
        assert main(["report", "--json"]) == 0
        body = json.loads(capsys.readouterr().out)
        assert body["readiness"]["score"] is None

    def test_doctor_runs_before_any_sync(self, settings):
        from garmin_analytics.cli import main

        Store.open(settings).close()
        assert main(["doctor"]) in (0, 1)          # may warn, must not raise
