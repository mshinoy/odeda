"""Fitbit: the second data source, and the only one that knows what the owner weighs.

The Aria scale writes to Fitbit, not to Garmin, which is why `body_composition` has a
schema and no rows. This module is the OAuth flow and the HTTP client; `fitbit_body.py`
turns what it fetches into rows.

Three things shape the design.

**The auth layer is Google's now.** The URLs are still Fitbit's and the data endpoints
are unchanged, but a 401 comes back in Google's `UNAUTHENTICATED` envelope rather than
Fitbit's classic `{"errors": [...]}` shape. Both are parsed, because which one arrives
is not ours to decide and an unreadable error is worse than a wrong one.

**Everything goes through an injectable transport.** Not for elegance: the credential
belongs to one person's Fitbit account, so the only way to know this code is right
before it ever meets a real one is to drive the whole flow — authorize, exchange,
refresh, rotate, 401-retry, 429 — against handcrafted payloads. `tests/test_fitbit_auth.py`
does exactly that, the way `test_login_transport.py` does for Garmin.

**Stdlib only.** Four calls against a documented JSON API do not justify a dependency,
and `urllib.request` behind a one-method protocol is what makes the fake transport a
dozen lines.

Nothing here writes a client id, a client secret, a code, a verifier or a token to a
log or to the database. The secret comes from the environment and the tokens live in a
0600 file on the data volume, the same place and the same modes as Garmin's.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol

log = logging.getLogger("garmin_analytics.fitbit")

AUTHORIZE_URL = "https://www.fitbit.com/oauth2/authorize"
TOKEN_URL = "https://api.fitbit.com/oauth2/token"
API_ROOT = "https://api.fitbit.com"

#: The only permission this app asks for. Weight is all it reads, and a scope it does
#: not need is a scope it can leak.
SCOPE = "weight"

#: Access tokens from the authorization-code flow last 8 hours and no longer — Fitbit
#: rejects any other `expires_in`. So the refresh path is not an edge case that fires
#: once a year like Garmin's; it fires on almost every sync.
ACCESS_TOKEN_TTL_S = 28800

#: Refresh a little before the token actually dies, so a long backfill does not expire
#: mid-run and spend a call finding out.
EXPIRY_SKEW_S = 300

#: Where the token cache lands inside `GA_TOKEN_DIR`. Named, not globbed, so
#: `disconnect` cannot be talked into deleting Garmin's cache next to it.
TOKEN_FILENAME = "fitbit_tokens.json"

#: The redirect Fitbit sends the browser back to. It has to match what is registered at
#: dev.fitbit.com character for character, so it is one constant with one override.
DEFAULT_REDIRECT_URI = "http://localhost:8000/api/fitbit/callback"


def redirect_uri() -> str:
    return os.environ.get("GA_FITBIT_REDIRECT_URI", DEFAULT_REDIRECT_URI).strip()


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class FitbitError(Exception):
    """Anything that went wrong talking to Fitbit."""


class NotConnected(FitbitError):
    """No usable token. The user has to authorise the app."""


class NeedsReauthorization(FitbitError):
    """The refresh token was rejected. Only a fresh consent gets back in.

    Distinct from `NotConnected` because the remedy is the same but the cause is not:
    this one means a cache existed and Fitbit refused it, which is worth saying out
    loud rather than reporting as "not connected yet".
    """


@dataclass
class RateLimited(FitbitError):
    """429. Fitbit allows 150 requests per hour per user and then stops answering."""

    retry_after_s: int

    def __str__(self) -> str:
        return f"Fitbit rate limit reached; it resets in {self.retry_after_s} s"


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Response:
    status: int
    headers: Mapping[str, str]
    body: bytes

    def json(self) -> Any:
        if not self.body:
            return None
        try:
            return json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise FitbitError(f"Fitbit returned something that is not JSON ({exc}).") from exc

    def header(self, name: str) -> str | None:
        lowered = {k.lower(): v for k, v in self.headers.items()}
        return lowered.get(name.lower())


class Transport(Protocol):
    """One method, so a fake is a dozen lines and covers the whole module."""

    def request(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None = None,
    ) -> Response: ...


class UrllibTransport:
    """The real one. Stdlib, and it treats a 4xx as an answer rather than an exception.

    `urlopen` raises on any non-2xx, but every interesting thing Fitbit says — the 401
    that means "refresh", the 429 that means "wait", the 400 that explains what was
    wrong with the request — arrives as a 4xx with a body worth reading.
    """

    def __init__(self, timeout_s: float = 30.0):
        self.timeout_s = timeout_s

    def request(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None = None,
    ) -> Response:
        request = urllib.request.Request(url, data=body, method=method)
        for key, value in headers.items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as resp:
                return Response(int(resp.status), dict(resp.headers), resp.read())
        except urllib.error.HTTPError as exc:
            return Response(int(exc.code), dict(exc.headers or {}), exc.read())
        except urllib.error.URLError as exc:
            raise FitbitError(f"Could not reach Fitbit ({exc.reason}).") from exc


# ---------------------------------------------------------------------------
# Credentials and tokens
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Credentials:
    """The app's own identity, from the environment. Never from the database.

    A Personal app at dev.fitbit.com issues both. They identify the *application*, not
    the person, but the secret is still a secret: it is read once at the point of use
    and never stored, echoed or logged.
    """

    client_id: str
    client_secret: str

    @classmethod
    def from_env(cls) -> "Credentials":
        client_id = os.environ.get("FITBIT_CLIENT_ID", "").strip()
        client_secret = os.environ.get("FITBIT_CLIENT_SECRET", "").strip()
        if not client_id or not client_secret:
            raise NotConnected(
                "FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET are not set. Register a "
                "Personal app at dev.fitbit.com/apps and put them in the environment."
            )
        return cls(client_id, client_secret)

    @staticmethod
    def configured() -> bool:
        return bool(
            os.environ.get("FITBIT_CLIENT_ID", "").strip()
            and os.environ.get("FITBIT_CLIENT_SECRET", "").strip()
        )

    def basic_auth(self) -> str:
        raw = f"{self.client_id}:{self.client_secret}".encode("utf-8")
        return "Basic " + base64.b64encode(raw).decode("ascii")

    def __repr__(self) -> str:  # pragma: no cover - only reachable from a traceback
        """Never let a secret into a traceback or a log line."""
        return f"Credentials(client_id={self.client_id[:4]}…, client_secret=…)"


@dataclass(frozen=True)
class Tokens:
    access_token: str
    refresh_token: str
    #: Unix seconds. Absolute, not a duration, so a cache loaded tomorrow knows.
    expires_at: float
    scope: str = ""
    user_id: str = ""

    def expired(self, now: float | None = None, skew_s: int = EXPIRY_SKEW_S) -> bool:
        return (now if now is not None else time.time()) >= self.expires_at - skew_s

    def to_dict(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "scope": self.scope,
            "user_id": self.user_id,
        }

    @classmethod
    def from_token_response(cls, payload: Mapping[str, Any], now: float) -> "Tokens":
        access = str(payload.get("access_token") or "")
        refresh = str(payload.get("refresh_token") or "")
        if not access or not refresh:
            # A response with only an access token cannot be resumed tomorrow, and
            # writing it would report a connection that fails on the next sync.
            raise FitbitError(
                "Fitbit returned a token response with no refresh token; a session that "
                "cannot be resumed is not a connection."
            )
        expires_in = payload.get("expires_in")
        ttl = float(expires_in) if isinstance(expires_in, (int, float)) else ACCESS_TOKEN_TTL_S
        return cls(
            access_token=access,
            refresh_token=refresh,
            expires_at=now + ttl,
            scope=str(payload.get("scope") or ""),
            user_id=str(payload.get("user_id") or ""),
        )

    def __repr__(self) -> str:  # pragma: no cover - only reachable from a traceback
        return f"Tokens(user_id={self.user_id!r}, expires_at={self.expires_at}, …)"


# ---------------------------------------------------------------------------
# The token cache on the data volume
# ---------------------------------------------------------------------------


def token_file(token_dir: Path) -> Path:
    return token_dir / TOKEN_FILENAME


def is_connected(token_dir: Path) -> bool:
    return token_file(token_dir).is_file()


def save_tokens(tokens: Tokens, token_dir: Path) -> None:
    """0600 inside a 0700 directory, written before the mode is relaxed by nothing."""
    token_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(token_dir, 0o700)
    path = token_file(token_dir)
    # Create with the right mode rather than fixing it afterwards: between the write
    # and the chmod, a world-readable refresh token would be on disk.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(tokens.to_dict(), fh)
    os.chmod(path, 0o600)


def load_tokens(token_dir: Path) -> Tokens | None:
    path = token_file(token_dir)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise NeedsReauthorization(
            f"The Fitbit token cache in {token_dir} is unreadable ({exc}). Connect again."
        ) from exc
    if not raw.get("access_token") or not raw.get("refresh_token"):
        raise NeedsReauthorization(
            f"The Fitbit token cache in {token_dir} is incomplete. Connect again."
        )
    return Tokens(
        access_token=str(raw["access_token"]),
        refresh_token=str(raw["refresh_token"]),
        expires_at=float(raw.get("expires_at") or 0.0),
        scope=str(raw.get("scope") or ""),
        user_id=str(raw.get("user_id") or ""),
    )


def forget_tokens(token_dir: Path) -> int:
    """Delete the cache. The only way to disconnect the Fitbit account."""
    path = token_file(token_dir)
    if not path.is_file():
        return 0
    path.unlink()
    return 1


# ---------------------------------------------------------------------------
# Authorization Code flow with PKCE
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PendingAuthorization:
    """What the caller has to hold on to between opening the URL and pasting the code.

    The verifier is the secret half of PKCE and never leaves this process until it is
    sent to the token endpoint; `state` is the anti-forgery value that has to come back
    unchanged. Held in memory by the caller for a few minutes and never written to disk.
    """

    url: str
    state: str
    verifier: str
    redirect_uri: str

    def __repr__(self) -> str:  # pragma: no cover - only reachable from a traceback
        return f"PendingAuthorization(state={self.state!r}, redirect_uri={self.redirect_uri!r})"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def code_challenge(verifier: str) -> str:
    """S256: BASE64URL(SHA256(ASCII(verifier))), unpadded.

    The padding matters. Fitbit compares the challenge it stored against the one it
    derives from the verifier, and a `=` on the end of either makes two identical
    verifiers look different.
    """
    return _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def begin_authorization(
    client_id: str,
    redirect: str | None = None,
    make_secret: Callable[[int], str] = secrets.token_urlsafe,
) -> PendingAuthorization:
    """Build the consent URL. Nothing leaves the machine here — it is pure string work.

    `make_secret` is injected so a test can pin the exact URL; it defaults to the real
    CSPRNG and no caller in the app passes anything else.
    """
    verifier = make_secret(64)
    target = (redirect or redirect_uri()).strip()
    state = make_secret(16)
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "scope": SCOPE,
            "redirect_uri": target,
            "state": state,
            "code_challenge": code_challenge(verifier),
            "code_challenge_method": "S256",
        }
    )
    return PendingAuthorization(
        url=f"{AUTHORIZE_URL}?{query}",
        state=state,
        verifier=verifier,
        redirect_uri=target,
    )


_CODE_RE = re.compile(r"[?&#]code=([A-Za-z0-9._~-]+)")


def extract_code(pasted: str, expected_state: str | None = None) -> str:
    """Pull the authorization code out of whatever the user pasted.

    They may paste the whole redirect URL out of the address bar or just the code, and
    telling someone their URL is the wrong shape helps nobody — the Garmin ticket
    fallback learned this already.

    When `expected_state` is given and the pasted text carries a `state`, the two must
    match. That is the anti-forgery check, and it is done here rather than at the call
    site so no route can forget it.
    """
    text = (pasted or "").strip()
    if not text:
        raise FitbitError("Nothing was pasted. Copy the address bar after approving.")

    if expected_state and ("state=" in text):
        parsed = urllib.parse.urlparse(text)
        params = urllib.parse.parse_qs(parsed.query or parsed.fragment)
        got = (params.get("state") or [""])[0]
        if got != expected_state:
            raise FitbitError(
                "That redirect belongs to a different sign-in attempt. Start again from "
                "the Connect button so the state matches."
            )

    match = _CODE_RE.search(text)
    if match:
        return match.group(1)
    if re.fullmatch(r"[A-Za-z0-9._~-]{8,}", text):
        return text
    raise FitbitError(
        "No Fitbit authorization code in that text. After approving, the address bar "
        "contains `?code=…` — paste that whole URL."
    )


def _form(body: Mapping[str, str]) -> bytes:
    return urllib.parse.urlencode(body).encode("ascii")


def _token_request(
    creds: Credentials,
    body: Mapping[str, str],
    transport: Transport,
    now: float,
) -> Tokens:
    response = transport.request(
        "POST",
        TOKEN_URL,
        {
            "Authorization": creds.basic_auth(),
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        _form(body),
    )
    if response.status >= 400:
        raise _auth_error(response)
    payload = response.json()
    if not isinstance(payload, Mapping):
        raise FitbitError("Fitbit's token endpoint returned something unexpected.")
    return Tokens.from_token_response(payload, now)


def exchange_code(
    creds: Credentials,
    pending: PendingAuthorization,
    code: str,
    transport: Transport,
    now: float | None = None,
) -> Tokens:
    """Trade the authorization code for the first pair of tokens.

    The code is valid for ten minutes and once. `redirect_uri` has to be byte-identical
    to the one in the consent URL or Fitbit rejects the exchange — which is why it is
    carried on `pending` rather than read from the environment a second time, where an
    edited variable could silently change it between the two calls.
    """
    return _token_request(
        creds,
        {
            "grant_type": "authorization_code",
            "client_id": creds.client_id,
            "code": code,
            "redirect_uri": pending.redirect_uri,
            "code_verifier": pending.verifier,
        },
        transport,
        now if now is not None else time.time(),
    )


def refresh_tokens(
    creds: Credentials,
    tokens: Tokens,
    transport: Transport,
    now: float | None = None,
) -> Tokens:
    """Swap the refresh token for a new pair.

    **Fitbit rotates the refresh token**: the response carries a new one and the old one
    stops working immediately. Losing the new one means the account has to be authorised
    by hand again, so every caller of this writes the result to the cache before it does
    anything else with it.
    """
    return _token_request(
        creds,
        {
            "grant_type": "refresh_token",
            "client_id": creds.client_id,
            "refresh_token": tokens.refresh_token,
        },
        transport,
        now if now is not None else time.time(),
    )


# ---------------------------------------------------------------------------
# Reading errors, in both dialects
# ---------------------------------------------------------------------------


def error_message(response: Response) -> str:
    """One readable line out of whichever error envelope arrived.

    Fitbit's classic shape is `{"errors": [{"errorType": …, "message": …}]}`. Since the
    auth layer moved to Google identity, a 401 arrives as Google's
    `{"error": {"code": 401, "status": "UNAUTHENTICATED", "message": …}}` instead, and
    OAuth's own `{"error": "invalid_grant", "error_description": …}` shows up on the
    token endpoint. All three are parsed because which one comes back is not ours to
    decide, and an unparsed body reaches the user as a wall of JSON.
    """
    try:
        payload = response.json()
    except FitbitError:
        payload = None

    if isinstance(payload, Mapping):
        errors = payload.get("errors")
        if isinstance(errors, list) and errors:
            first = errors[0]
            if isinstance(first, Mapping):
                message = first.get("message") or first.get("errorType")
                if message:
                    return str(message)
        error = payload.get("error")
        if isinstance(error, Mapping):
            message = error.get("message") or error.get("status")
            if message:
                return str(message)
        if isinstance(error, str):
            detail = payload.get("error_description")
            return f"{error}: {detail}" if detail else error

    return f"HTTP {response.status}"


def _auth_error(response: Response) -> FitbitError:
    detail = error_message(response)
    if response.status == 429:
        return RateLimited(retry_after_s=retry_after(response))
    if response.status in (400, 401):
        return NeedsReauthorization(
            f"Fitbit would not issue a token ({detail}). Authorise the app again — a "
            "code is single-use and expires in ten minutes, and a refresh token that "
            "has been rotated is already spent."
        )
    return FitbitError(f"Fitbit's token endpoint failed ({detail}).")


def retry_after(response: Response) -> int:
    """How long to wait, from whichever header Fitbit chose to send.

    `fitbit-rate-limit-reset` is seconds until the hourly window rolls; `Retry-After` is
    the standard one. An hour is the fallback because that is the window length, and
    guessing shorter just burns another request on another 429.
    """
    for header in ("fitbit-rate-limit-reset", "retry-after"):
        raw = response.header(header)
        if raw and raw.strip().isdigit():
            return int(raw.strip())
    return 3600


def rate_limit_remaining(response: Response) -> int | None:
    """Calls left in this hour, when Fitbit says. Approximate by its own documentation."""
    raw = response.header("fitbit-rate-limit-remaining")
    if raw and raw.strip().lstrip("-").isdigit():
        return int(raw.strip())
    return None


# ---------------------------------------------------------------------------
# The client
# ---------------------------------------------------------------------------


class FitbitClient:
    """An authenticated session that keeps its own token cache current.

    Holding the token directory rather than just the tokens is deliberate: a rotated
    refresh token that is not written down is lost, and the failure only shows up on
    the next run, hours later, as an inexplicable "authorise again".
    """

    def __init__(
        self,
        creds: Credentials,
        tokens: Tokens,
        token_dir: Path,
        transport: Transport | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.creds = creds
        self.tokens = tokens
        self.token_dir = Path(token_dir)
        self.transport: Transport = transport or UrllibTransport()
        self.clock = clock
        #: What the last response said was left in the hourly window. The backfill reads
        #: it to pace itself rather than waiting for the 429 it can see coming.
        self.remaining: int | None = None

    @classmethod
    def resume(
        cls,
        token_dir: Path,
        creds: Credentials | None = None,
        transport: Transport | None = None,
        clock: Callable[[], float] = time.time,
    ) -> "FitbitClient":
        tokens = load_tokens(Path(token_dir))
        if tokens is None:
            raise NotConnected(
                f"No Fitbit token cache in {token_dir}. Connect the account in Settings, "
                "or run `garmin-analytics fitbit connect`."
            )
        return cls(creds or Credentials.from_env(), tokens, Path(token_dir), transport, clock)

    # -- tokens ------------------------------------------------------------------

    def _store(self, tokens: Tokens) -> None:
        self.tokens = tokens
        save_tokens(tokens, self.token_dir)

    def ensure_fresh(self) -> None:
        """Refresh if the access token is at or near its eight hours."""
        if self.tokens.expired(self.clock()):
            self._store(refresh_tokens(self.creds, self.tokens, self.transport, self.clock()))

    # -- requests ----------------------------------------------------------------

    def get(self, path: str) -> Any:
        """A GET against the API, refreshing once if the token turns out to be dead.

        The proactive expiry check is not enough on its own: Fitbit can revoke a token
        early, and the clock in a container can be wrong. So a 401 is retried once after
        a refresh, and a second 401 is reported rather than looped on.
        """
        self.ensure_fresh()
        response = self._authorised_get(path)
        if response.status == 401:
            self._store(refresh_tokens(self.creds, self.tokens, self.transport, self.clock()))
            response = self._authorised_get(path)

        if response.status == 429:
            raise RateLimited(retry_after_s=retry_after(response))
        if response.status == 401:
            raise NeedsReauthorization(
                f"Fitbit rejected the refreshed token ({error_message(response)}). "
                "The app's access was probably revoked; authorise it again."
            )
        if response.status >= 400:
            raise FitbitError(f"Fitbit refused {path} ({error_message(response)}).")
        return response.json()

    def _authorised_get(self, path: str) -> Response:
        url = path if path.startswith("http") else f"{API_ROOT}/{path.lstrip('/')}"
        response = self.transport.request(
            "GET",
            url,
            {
                "Authorization": f"Bearer {self.tokens.access_token}",
                "Accept": "application/json",
                # Metric, explicitly. The default follows the account's locale, and a
                # silent switch to pounds would write a weight three digits wrong
                # into a column called weight_kg.
                "Accept-Language": "en_GB",
            },
        )
        seen = rate_limit_remaining(response)
        if seen is not None:
            self.remaining = seen
        return response

    def profile(self) -> Mapping[str, Any]:
        """The account this token belongs to. Used to show *which* Fitbit is connected."""
        payload = self.get("/1/user/-/profile.json")
        user = payload.get("user") if isinstance(payload, Mapping) else None
        return user if isinstance(user, Mapping) else {}

    def display_name(self) -> str:
        profile = self.profile()
        return str(profile.get("displayName") or profile.get("fullName") or "")


def connected_account(token_dir: Path) -> str:
    """The stored user id, without a network call. Empty when not connected."""
    try:
        tokens = load_tokens(Path(token_dir))
    except NeedsReauthorization:
        return ""
    return tokens.user_id if tokens else ""
