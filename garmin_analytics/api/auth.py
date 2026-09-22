"""App password, session cookies, and the Garmin connection flow.

Scope, deliberately small: this is **single-tenant**. One deployment is one person's
data. There is no user table, no registration, no roles — just one shared password
that stops the container being wide open to whoever finds the port.

What is protected, and how:

* `APP_PASSWORD` is read from the environment, then stored **only** as a salted
  PBKDF2-SHA256 hash in the database. The plaintext never reaches disk.
* A session cookie carries a 256-bit random token. Only its SHA-256 hash is stored,
  so a database copy cannot be replayed as a live session.
* Sessions live in the database rather than in memory, so restarting the container
  (or `docker compose up -d` after an image change) does not log the user out.
* The Garmin password is used for exactly one call — the token exchange — and is
  never stored, logged or written anywhere. What persists is garth's OAuth token
  cache, on the volume, mode 0600.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..db.store import Store, utcnow

#: PBKDF2 iterations. Deliberately high: this runs once per login attempt, never in
#: a hot path, and the password is likely to be short.
PBKDF2_ROUNDS = 240_000
SALT_BYTES = 16
TOKEN_BYTES = 32

COOKIE_NAME = "ga_session"
SESSION_TTL_DAYS = 30

#: Where the password hash lives. Key names, not secrets.
_HASH_KEY = "auth.password_hash"
_SALT_KEY = "auth.password_salt"
_SOURCE_KEY = "auth.password_source"

#: In-flight Garmin MFA challenges: challenge_id -> (expires_at, client_state).
#: In memory only, and short-lived by design — `client_state` is an auth context and
#: has no business being written to disk.
_MFA_CHALLENGES: dict[str, tuple[float, Any]] = {}
MFA_TTL_S = 600.0


# ---------------------------------------------------------------------------
# Password
# ---------------------------------------------------------------------------


def _derive(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS
    ).hex()


def set_password(store: Store, password: str, source: str = "env") -> None:
    """Store a salted hash of `password`. The plaintext is not retained."""
    if not password:
        raise ValueError("password cannot be empty")
    salt = secrets.token_bytes(SALT_BYTES)
    store.set_setting(_SALT_KEY, salt.hex())
    store.set_setting(_HASH_KEY, _derive(password, salt))
    store.set_setting(_SOURCE_KEY, source)


def password_is_set(store: Store) -> bool:
    return bool(store.get_setting(_HASH_KEY))


def verify_password(store: Store, password: str) -> bool:
    """Constant-time check of a candidate password."""
    stored = store.get_setting(_HASH_KEY)
    salt_hex = store.get_setting(_SALT_KEY)
    if not stored or not salt_hex:
        return False
    candidate = _derive(password or "", bytes.fromhex(salt_hex))
    return hmac.compare_digest(candidate, stored)


def sync_password_from_env(store: Store, env_value: str | None = None) -> str:
    """Reconcile `APP_PASSWORD` with what is stored. Called once at startup.

    Returns one of: `set` (first time), `rotated` (the env var changed), `unchanged`,
    or `absent` (no password configured — the app then runs unprotected and says so
    loudly, which is only reasonable on a laptop).
    """
    value = env_value if env_value is not None else os.environ.get("APP_PASSWORD", "")
    value = (value or "").strip()
    if not value:
        return "unchanged" if password_is_set(store) else "absent"
    if not password_is_set(store):
        set_password(store, value)
        return "set"
    if verify_password(store, value):
        return "unchanged"
    # The env var was changed: rotate, and drop every existing session so the old
    # password cannot keep a browser logged in.
    set_password(store, value)
    clear_sessions(store)
    return "rotated"


def auth_required(store: Store) -> bool:
    """Whether requests must carry a session. False only when no password is set."""
    return password_is_set(store)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(store: Store, ttl_days: int = SESSION_TTL_DAYS, label: str = "") -> str:
    """Mint a session and return the **raw** token. Only its hash is persisted."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    expires = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    store.upsert(
        "sessions",
        ["token_hash"],
        {
            "token_hash": _hash_token(token),
            "created_at": utcnow(),
            "expires_at": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "label": label or None,
        },
    )
    store.conn.commit()
    purge_expired(store)
    return token


def session_valid(store: Store, token: str | None) -> bool:
    if not token:
        return False
    row = store.conn.execute(
        "SELECT expires_at FROM sessions WHERE token_hash = ?", (_hash_token(token),)
    ).fetchone()
    if row is None:
        return False
    try:
        expires = datetime.strptime(row["expires_at"], "%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return False
    return expires.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc)


def destroy_session(store: Store, token: str | None) -> bool:
    if not token:
        return False
    cur = store.conn.execute(
        "DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),)
    )
    store.conn.commit()
    return cur.rowcount > 0


def clear_sessions(store: Store) -> int:
    cur = store.conn.execute("DELETE FROM sessions")
    store.conn.commit()
    return cur.rowcount


def purge_expired(store: Store) -> int:
    cur = store.conn.execute(
        "DELETE FROM sessions WHERE expires_at <= ?",
        (datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),),
    )
    store.conn.commit()
    return cur.rowcount


def session_count(store: Store) -> int:
    return int(store.scalar("SELECT COUNT(*) FROM sessions") or 0)


# ---------------------------------------------------------------------------
# Garmin connection
# ---------------------------------------------------------------------------


def garmin_status(settings) -> dict[str, Any]:
    """Whether a Garmin token cache exists, without touching the network."""
    from ..ingest import connect as connect_mod

    token_dir = Path(settings.token_dir)
    connected = connect_mod.token_dir_is_populated(token_dir)
    newest = None
    if connected:
        stamps = [p.stat().st_mtime for p in token_dir.glob("oauth*token*.json")]
        if stamps:
            newest = datetime.fromtimestamp(max(stamps), timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
    return {
        "connected": connected,
        "token_dir": str(token_dir),
        "tokens_updated_at": newest,
    }


def _purge_challenges() -> None:
    now = time.monotonic()
    for key in [k for k, (exp, _) in _MFA_CHALLENGES.items() if exp < now]:
        _MFA_CHALLENGES.pop(key, None)


def garmin_login(settings, email: str, password: str) -> dict[str, Any]:
    """Exchange Garmin credentials for a token cache, pausing for MFA if asked.

    Returns either `{"status": "ok", ...}` or `{"status": "mfa_required",
    "challenge_id": ...}`. The password is not retained in either case.
    """
    from ..ingest import connect as connect_mod

    _purge_challenges()
    if not email or not password:
        raise ValueError("email and password are both required")

    outcome, payload = connect_mod.begin_login(email, password, Path(settings.token_dir))
    if outcome == "ok":
        return {"status": "ok", "display_name": payload, **garmin_status(settings)}

    challenge_id = secrets.token_urlsafe(16)
    _MFA_CHALLENGES[challenge_id] = (time.monotonic() + MFA_TTL_S, payload)
    return {
        "status": "mfa_required",
        "challenge_id": challenge_id,
        "expires_in_s": int(MFA_TTL_S),
    }


def garmin_mfa(settings, challenge_id: str, code: str) -> dict[str, Any]:
    """Finish a login that asked for a multi-factor code."""
    from ..ingest import connect as connect_mod

    _purge_challenges()
    entry = _MFA_CHALLENGES.pop(challenge_id, None)
    if entry is None:
        raise LookupError(
            "that login attempt has expired or was already used; start again"
        )
    _expires, client_state = entry
    name = connect_mod.finish_login(client_state, code, Path(settings.token_dir))
    return {"status": "ok", "display_name": name, **garmin_status(settings)}


def garmin_disconnect(settings) -> dict[str, Any]:
    from ..ingest import connect as connect_mod

    removed = connect_mod.logout(Path(settings.token_dir))
    return {"status": "ok", "removed_files": removed, **garmin_status(settings)}
