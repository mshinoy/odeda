"""One file with everything that cannot be fetched again.

The database holds the raw archive too (`raw_documents`), so a copy of it is a copy of
every Garmin response ever fetched and of every edit. Beside it go the files that live
only on disk: course GPX files and anything in the raw archive directory.

What it leaves out on purpose is the sign-in tokens. A backup is a file people email
to themselves and drop in cloud folders; it must not also be the key to a Garmin
account. Restoring means signing in to Garmin once more.

The database is copied with SQLite's own online backup, not by copying the file: a sync
writing at that moment would otherwise leave a copy that is torn in the middle.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .config import Settings

#: What the zip calls the database; restoring is putting this back as the data
#: directory's `garmin.db`.
DB_NAME = "garmin.db"


def backup_filename(now: datetime | None = None) -> str:
    return f"odeda-backup-{(now or datetime.now()).strftime('%Y-%m-%d')}.zip"


def _snapshot(db_path: Path, dest: Path) -> None:
    """A consistent copy of the live database, safe while it is being written."""
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        out = sqlite3.connect(str(dest))
        try:
            src.backup(out)
        finally:
            out.close()
    finally:
        src.close()


def _extra_files(settings: Settings) -> list[tuple[Path, str]]:
    """Files on disk the database does not hold, with the name each gets in the zip."""
    found: list[tuple[Path, str]] = []
    for folder, prefix in (
        (settings.data_dir / "courses", "courses"),
        (settings.raw_archive_dir, "raw_archive"),
    ):
        if folder.is_dir():
            for path in sorted(folder.rglob("*")):
                if path.is_file():
                    found.append((path, f"{prefix}/{path.relative_to(folder).as_posix()}"))
    return found


def make_backup(settings: Settings, dest: Path) -> dict:
    """Write the backup zip to `dest` and say what is in it."""
    if not settings.db_path.exists():
        raise FileNotFoundError(f"There is no database at {settings.db_path} to back up.")
    with tempfile.TemporaryDirectory(prefix="odeda-backup-") as tmp:
        snap = Path(tmp) / DB_NAME
        _snapshot(settings.db_path, snap)
        extras = _extra_files(settings)
        manifest = {
            "app": "odeda",
            "version": __version__,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "files": [DB_NAME, *[name for _, name in extras]],
            "left_out": "Garmin and Google sign-in tokens. Sign in again after restoring.",
        }
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(snap, DB_NAME)
            for path, name in extras:
                z.write(path, name)
            z.writestr("MANIFEST.json", json.dumps(manifest, indent=2))
    return manifest
