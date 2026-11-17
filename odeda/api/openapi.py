"""This checkout's OpenAPI document, built from the code rather than fetched.

`npm run gen:api` used to read `/openapi.json` off whatever was answering on port 8000.
On the owner's machine that is the **running container** — an older build — so
regenerating the types from a branch that adds an endpoint quietly produced a
`schema.ts` describing the deployed app instead, deleting the types for everything the
branch had added. The failure then surfaced as frontend type errors, pointing at the
wrong place entirely.

Building the app in-process removes the question. There is no port, no server to
forget to restart, and no way for the document to describe code that is not this one.

    python -m odeda.api.openapi > openapi.json
"""

from __future__ import annotations

import json
import sys
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Any


def build() -> dict[str, Any]:
    """The OpenAPI document for the app as this checkout defines it.

    Every path is pointed at a throwaway directory: creating the app touches the data
    and UI directories, and generating a schema must not read, create or migrate the
    owner's database as a side effect.
    """
    import os

    from ..config import load_settings
    from .server import create_app

    with tempfile.TemporaryDirectory(prefix="ga-openapi-") as tmp:
        root = Path(tmp)
        ui = root / "ui"
        (ui / "assets").mkdir(parents=True)
        (ui / "index.html").write_text("<!doctype html>")

        overrides = {
            "GA_DATA_DIR": str(root / "data"),
            "GA_DB": str(root / "data" / "openapi.db"),
            "GA_RAW_DIR": str(root / "data" / "raw"),
            "GA_TOKEN_DIR": str(root / "tokens"),
        }
        # Restored afterwards. The directory is deleted on the way out, so leaving the
        # process pointed at it would hand a dead path to the next `load_settings()` —
        # which matters because the tests import this module rather than shell out.
        previous = {k: os.environ.get(k) for k in overrides}
        os.environ.update(overrides)
        try:
            app = create_app(replace(load_settings(), ui_dir=ui))
            return app.openapi()
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


def main() -> int:
    # Not sorted: FastAPI emits routes in registration order, and matching what a
    # running server would have answered is what makes this a drop-in replacement for
    # fetching it. Sorting here would rewrite the generated file top to bottom the
    # first time anyone ran it, for no gain.
    json.dump(build(), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
