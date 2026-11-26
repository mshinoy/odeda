"""The backup zip: a consistent database, the files beside it, and no sign-in tokens."""

from __future__ import annotations

import json
import sqlite3
import zipfile

import pytest
from fastapi.testclient import TestClient

from odeda import backup as B
from odeda.api.server import create_app
from odeda.db.store import Store


@pytest.fixture
def populated(settings):
    settings.ensure_dirs()
    with Store.open(settings) as st:
        st.set_setting("marker", "kept")
    (settings.data_dir / "courses").mkdir()
    (settings.data_dir / "courses" / "2027-01-15.gpx").write_text("<gpx/>")
    (settings.raw_archive_dir / "a.json").write_text("{}")
    settings.token_dir.mkdir(parents=True)
    (settings.token_dir / "garmin_tokens.json").write_text("secret")
    return settings


class TestMakeBackup:
    def test_holds_the_database_and_the_files_beside_it(self, populated, tmp_path):
        out = tmp_path / "b.zip"
        B.make_backup(populated, out)
        with zipfile.ZipFile(out) as z:
            names = set(z.namelist())
            assert {"garmin.db", "MANIFEST.json", "courses/2027-01-15.gpx",
                    "raw_archive/a.json"} <= names
            z.extract("garmin.db", tmp_path / "restore")
        conn = sqlite3.connect(str(tmp_path / "restore" / "garmin.db"))
        assert conn.execute("SELECT value FROM app_settings WHERE key='marker'").fetchone()[0] == "kept"
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

    def test_never_includes_sign_in_tokens(self, populated, tmp_path):
        out = tmp_path / "b.zip"
        B.make_backup(populated, out)
        with zipfile.ZipFile(out) as z:
            assert not [n for n in z.namelist() if "token" in n.lower()]
            assert b"secret" not in b"".join(z.read(n) for n in z.namelist())

    def test_the_manifest_says_what_it_left_out(self, populated, tmp_path):
        out = tmp_path / "b.zip"
        manifest = B.make_backup(populated, out)
        assert "tokens" in manifest["left_out"]
        with zipfile.ZipFile(out) as z:
            assert json.loads(z.read("MANIFEST.json"))["files"][0] == "garmin.db"

    def test_a_missing_database_is_said_plainly(self, settings, tmp_path):
        with pytest.raises(FileNotFoundError):
            B.make_backup(settings, tmp_path / "b.zip")

    def test_the_name_carries_the_date(self):
        from datetime import datetime

        assert B.backup_filename(datetime(2026, 11, 26)) == "odeda-backup-2026-11-26.zip"


class TestApi:
    def test_downloads_a_zip(self, populated):
        with TestClient(create_app(populated)) as c:
            r = c.get("/api/backup")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/zip"
        assert "odeda-backup-" in r.headers["content-disposition"]
        assert r.content[:2] == b"PK"

    def test_leaves_no_temp_file_behind(self, populated, tmp_path, monkeypatch):
        import tempfile

        monkeypatch.setattr(tempfile, "tempdir", str(tmp_path / "tmp"))
        (tmp_path / "tmp").mkdir()
        with TestClient(create_app(populated)) as c:
            c.get("/api/backup")
        assert not list((tmp_path / "tmp").glob("odeda-backup-*.zip"))

    def test_refused_on_a_demo(self, populated):
        import dataclasses

        demo = dataclasses.replace(populated, demo=True)
        with TestClient(create_app(demo)) as c:
            assert c.get("/api/backup").status_code == 403
