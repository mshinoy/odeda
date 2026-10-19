"""CLI wiring and `doctor`.

The security-relevant assertion here: no command path ever accepts a password as an
argument or an environment variable, and `doctor` never prints token contents.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from garmin_analytics import cli, diagnostics
from garmin_analytics.ingest import connect


class TestParser:
    def test_every_documented_command_parses(self):
        parser = cli.build_parser()
        for argv in (["login"], ["sync"], ["renormalize"], ["import-zip", "x.zip"],
                     ["import-fit", "a.fit"], ["seed"], ["serve"], ["doctor"], ["report"]):
            args = parser.parse_args(argv)
            assert callable(args.func)

    def test_unknown_command_exits(self):
        with pytest.raises(SystemExit):
            cli.build_parser().parse_args(["teleport"])

    def test_no_command_exits(self):
        with pytest.raises(SystemExit):
            cli.build_parser().parse_args([])

    def test_defaults(self):
        args = cli.build_parser().parse_args(["sync"])
        assert args.days == 540
        args = cli.build_parser().parse_args(["serve"])
        assert args.host == "127.0.0.1" and args.port == 8808
        args = cli.build_parser().parse_args(["seed"])
        # `--months` defaults to None so the single source of truth stays
        # `synthetic.DEFAULT_MONTHS` rather than being duplicated in the parser.
        from garmin_analytics.seed.synthetic import DEFAULT_MONTHS

        assert args.months is None and args.reset is False
        assert DEFAULT_MONTHS >= 36, "the seed must cover 3+ years for routes and YoY"

    def test_serve_binds_loopback_by_default(self):
        """This is personal health data; it does not go on 0.0.0.0 by accident."""
        assert cli.build_parser().parse_args(["serve"]).host == "127.0.0.1"

    def test_import_fit_defaults_to_qatar_offset(self):
        assert cli.build_parser().parse_args(["import-fit", "a.fit"]).tz_offset == 3.0

    def test_no_command_takes_a_password_argument(self):
        """A password on the command line lands in shell history and `ps`."""
        parser = cli.build_parser()
        for argv in (["login"], ["sync"], ["seed"], ["serve"], ["doctor"]):
            args = parser.parse_args(argv)
            assert not any("pass" in k.lower() for k in vars(args))

    def test_every_command_supports_json_output(self):
        parser = cli.build_parser()
        for name in ("sync", "seed", "doctor", "report", "renormalize"):
            assert parser.parse_args([name, "--json"]).json is True


class TestSeedCommand:
    def test_seeds_and_reports(self, settings, capsys):
        rc = cli.main(["seed", "--months", "1", "--end", "2026-09-22", "--reset"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "SYNTHETIC" in out
        assert "activities=" in out

    def test_refuses_to_overwrite_without_reset(self, settings, capsys):
        cli.main(["seed", "--months", "1", "--end", "2026-09-22", "--reset"])
        rc = cli.main(["seed", "--months", "1", "--end", "2026-09-22"])
        assert rc == 1
        assert "--reset" in capsys.readouterr().err

    def test_json_output_is_parseable(self, settings, capsys):
        cli.main(["seed", "--months", "1", "--end", "2026-09-22", "--reset", "--json"])
        blob = capsys.readouterr().out
        payload = json.loads(blob[blob.index("{"):])
        assert payload["days"] > 20


class TestReportCommand:
    def test_prints_the_essentials(self, settings, capsys):
        cli.main(["seed", "--months", "3", "--end", "2026-09-22", "--reset"])
        capsys.readouterr()
        assert cli.main(["report"]) == 0
        out = capsys.readouterr().out
        assert "readiness" in out
        assert "training load" in out
        # The race is the calendar's now (T57) and a seeded store has none, so the
        # report says so instead of naming a race nobody entered.
        assert "No race in the calendar" in out

    def test_json_mode(self, settings, capsys):
        cli.main(["seed", "--months", "2", "--end", "2026-09-22", "--reset"])
        capsys.readouterr()
        cli.main(["report", "--json"])
        payload = json.loads(capsys.readouterr().out)
        assert set(payload) == {"readiness", "load", "race", "reports"}


class TestSyncCommandWithoutCredentials:
    def test_exits_cleanly_when_not_logged_in(self, settings, capsys):
        """No tokens is a clear message and exit 2 — not a traceback."""
        rc = cli.main(["sync"])
        assert rc == 2
        assert "login" in capsys.readouterr().err


class TestImportFitCommand:
    def test_reports_when_there_is_nothing_to_import(self, settings, tmp_path, capsys):
        assert cli.main(["import-fit", str(tmp_path)]) == 1
        assert "No .fit files" in capsys.readouterr().err

    def test_imports_a_directory(self, settings, tmp_path, capsys):
        import datetime as dt
        import sys

        sys.path.insert(0, str(Path(__file__).parent))
        import fitgen

        start = dt.datetime(2026, 9, 20, 6, 0, tzinfo=dt.timezone.utc)
        d = tmp_path / "fits"
        d.mkdir()
        fitgen.write_fit(d / "a.fit", start, fitgen.steady_run(start, duration_s=1200))
        assert cli.main(["import-fit", str(d)]) == 0
        assert "Imported 1/1" in capsys.readouterr().out

    def test_a_corrupt_file_is_reported_not_fatal(self, settings, tmp_path, capsys):
        bad = tmp_path / "bad.fit"
        bad.write_bytes(b"this is not a FIT file")
        assert cli.main(["import-fit", str(bad)]) == 1
        assert "skipped bad.fit" in capsys.readouterr().out


class TestDoctor:
    def test_runs_and_reports_overall_status(self, settings, capsys):
        rc = cli.main(["doctor"])
        out = capsys.readouterr().out
        assert "overall:" in out
        assert rc in (0, 1)

    def test_json_mode(self, settings, capsys):
        cli.main(["doctor", "--json"])
        payload = json.loads(capsys.readouterr().out)
        assert payload["overall"] in {"ok", "warn", "fail"}
        assert {c["check"] for c in payload["checks"]} >= {
            "python", "venv", "disk", "garmin auth", "web ui"}

    def test_warns_about_a_missing_database(self, settings):
        result = diagnostics.run_doctor(settings)
        db = [c for c in result["checks"] if c["check"] == "database"][0]
        assert db["status"] == "warn"
        assert "seed" in db["detail"]

    def test_reports_synthetic_provenance(self, settings, capsys):
        cli.main(["seed", "--months", "1", "--end", "2026-09-22", "--reset"])
        result = diagnostics.run_doctor(settings)
        prov = [c for c in result["checks"] if c["check"] == "data provenance"][0]
        assert prov["synthetic"] is True
        assert "Not your real training" in prov["detail"]

    def test_reports_real_provenance_when_not_seeded(self, store, settings):
        prov = [c for c in diagnostics.run_doctor(settings)["checks"]
                if c["check"] == "data provenance"][0]
        assert prov["synthetic"] is False

    def test_auth_check_is_a_warning_not_a_failure(self, settings):
        """Synthetic data works without Garmin; a missing login must not read as broken."""
        auth = [c for c in diagnostics.run_doctor(settings)["checks"]
                if c["check"] == "garmin auth"][0]
        assert auth["status"] == "warn" and auth["authenticated"] is False

    def test_auth_check_reports_presence_and_mode_but_never_contents(self, settings):
        settings.token_dir.mkdir(parents=True, exist_ok=True)
        token = settings.token_dir / connect.TOKEN_FILENAME
        token.write_text('{"access_token": "SUPERSECRETVALUE"}')
        token.chmod(0o600)
        auth = [c for c in diagnostics.run_doctor(settings)["checks"]
                if c["check"] == "garmin auth"][0]
        assert auth["authenticated"] is True
        assert "SUPERSECRETVALUE" not in json.dumps(auth)
        assert "0o600" in auth["detail"]

    def test_loose_token_permissions_are_flagged(self, settings):
        settings.token_dir.mkdir(parents=True, exist_ok=True)
        token = settings.token_dir / connect.TOKEN_FILENAME
        token.write_text("{}")
        token.chmod(0o644)
        auth = [c for c in diagnostics.run_doctor(settings)["checks"]
                if c["check"] == "garmin auth"][0]
        assert auth["status"] == "warn"
        assert "0600" in auth["detail"]

    def test_no_token_value_appears_anywhere_in_the_report(self, settings):
        settings.token_dir.mkdir(parents=True, exist_ok=True)
        (settings.token_dir / connect.TOKEN_FILENAME).write_text('{"refresh_token": "LEAKME"}')
        assert "LEAKME" not in json.dumps(diagnostics.run_doctor(settings))

    def test_a_built_ui_is_reported(self, settings, fake_ui):
        from dataclasses import replace

        ui = [c for c in diagnostics.run_doctor(replace(settings, ui_dir=fake_ui))["checks"]
              if c["check"] == "web ui"][0]
        assert ui["status"] == "ok" and ui["built"] is True

    def test_a_missing_ui_build_is_a_warning_not_a_failure(self, settings, tmp_path):
        """The API works without the SPA; an unbuilt frontend must not read as broken."""
        from dataclasses import replace

        ui = [c for c in diagnostics.run_doctor(replace(settings, ui_dir=tmp_path / "nope"))
              ["checks"] if c["check"] == "web ui"][0]
        assert ui["status"] == "warn" and ui["built"] is False
        assert "npm run build" in ui["detail"]

    def test_the_garmin_client_reports_a_real_version(self, settings):
        """garminconnect exposes no __version__ attribute, so doctor has to ask the
        installer. A bare "?" here means a version pin nobody can check."""
        dep = [c for c in diagnostics.run_doctor(settings)["checks"]
               if c["check"] == "dep:garminconnect"][0]
        assert dep["status"] == "ok"
        assert dep["detail"][0].isdigit(), dep["detail"]

    def test_garth_is_gone(self, settings):
        checks = {c["check"] for c in diagnostics.run_doctor(settings)["checks"]}
        assert "dep:garth" not in checks


class TestMain:
    def test_keyboard_interrupt_returns_130(self, settings, monkeypatch, capsys):
        def boom(_args):
            raise KeyboardInterrupt

        monkeypatch.setattr(cli, "cmd_doctor", boom)
        assert cli.main(["doctor"]) == 130
