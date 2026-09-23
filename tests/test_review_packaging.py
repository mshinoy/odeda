"""Open-source hygiene: a clean clone contains what the README tells you to use.

Found by the adversarial review pass of 2026-09-22 (DECISIONS.md D43; the review
itself is in git history: `git show 0a9d297:REVIEW.md`). Every test here failed
against the code as first written.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent




def test_env_example_is_committed_and_not_ignored():
    """`cp .env.example .env` is step three of the quickstart; the file must ship."""
    assert (REPO / ".env.example").is_file()
    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", ".env.example"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert tracked.returncode == 0, ".env.example is not tracked by git"
    ignored = subprocess.run(
        ["git", "check-ignore", ".env.example"], cwd=REPO, capture_output=True, text=True
    )
    assert ignored.returncode != 0, ".gitignore excludes .env.example"


def test_real_env_is_still_ignored_and_uncommitted():
    """The opposite mistake: .env must stay out of the repo forever."""
    ignored = subprocess.run(
        ["git", "check-ignore", ".env"], cwd=REPO, capture_output=True, text=True
    )
    assert ignored.returncode == 0, ".env is not gitignored"
    history = subprocess.run(
        ["git", "log", "--all", "--full-history", "--oneline", "--", ".env"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert history.stdout.strip() == "", ".env appears in git history"


def test_env_example_documents_every_setting_the_readme_promises():
    text = (REPO / ".env.example").read_text()
    for key in ("APP_PASSWORD", "GA_COOKIE_SECURE", "GA_SEED_DEMO",
                "GA_HR_REST", "GA_HR_MAX", "TZ"):
        assert key in text, f"{key} is undocumented in .env.example"


def test_no_app_password_value_is_committed():
    """A password in a public repo is a default password for every deployment."""
    # Assembled at runtime so this file is not itself a match.
    needle = "verify" + "-me-" + "2026"
    hit = subprocess.run(
        ["git", "grep", "-nI", "-e", needle, "--", ":!tests/"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert hit.stdout.strip() == "", f"a live password is committed:\n{hit.stdout}"


def test_no_plaintext_password_assignment_is_committed():
    """More general: no tracked file may assign a non-placeholder APP_PASSWORD."""
    # 8+ characters: short ones in prose ("people just set APP_PASSWORD=x") are
    # documentation, not a credential.
    hit = subprocess.run(
        ["git", "grep", "-nIE", r"APP_PASSWORD[=:][ ]*[A-Za-z0-9_-]{8,}", "--",
         ":!tests/", ":!.env.example"],
        cwd=REPO, capture_output=True, text=True,
    )
    assert hit.stdout.strip() == "", f"a password value is committed:\n{hit.stdout}"
