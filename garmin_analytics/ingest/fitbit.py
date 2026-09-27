"""Fitbit: the second data source, and the only one that knows what the owner weighs.

The Aria scale writes to Fitbit, not to Garmin, which is why `body_composition` has a
schema and no rows. This module is the OAuth flow and the HTTP client; `fitbit_body.py`
turns what it fetches into rows.

Three things shape the design.

**This talks to the Google Health API, not the Fitbit Web API.** The Fitbit Web API is
being retired; Google Health is its replacement and it is a different service, not a
rebrand. Registration is a Google Cloud OAuth client, consent is Google's, the token
endpoint is Google's, and the data lives at `health.googleapis.com/v4`. The module keeps
the `fitbit` name because the *scale* is still an Aria and the database column is still
`body_composition` — renaming the file would churn every import to say nothing new.

**Everything goes through an injectable transport.** Not for elegance: the credential
belongs to one person's Google account, so the only way to know this code is right
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

#: Google's OAuth 2.0 endpoints. The Fitbit ones (`www.fitbit.com/oauth2/authorize`,
#: `api.fitbit.com/oauth2/token`) belong to the retiring service and will not accept a
#: Google Cloud client id at all.
AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API_ROOT = "https://health.googleapis.com/v4"

#: The only permission this app asks for. Weight and body fat are both "health metrics
#: and measurements", and read-only because nothing here ever writes to Google Health.
#: A scope it does not need is a scope it can leak.
_HEALTH_SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth"
SCOPE = f"{_HEALTH_SCOPE_PREFIX}.health_metrics_and_measurements.readonly"

#: Google's access tokens are an hour, not Fitbit's eight. Only a fallback: the token
#: response carries `expires_in` and that is what is used when present.
ACCESS_TOKEN_TTL_S = 3600

#: Refresh a little before the token actually dies, so a long backfill does not expire
#: mid-run and spend a call finding out.
EXPIRY_SKEW_S = 300

#: Where the token cache lands inside `GA_TOKEN_DIR`. Named, not globbed, so
#: `disconnect` cannot be talked into deleting Garmin's cache next to it.
TOKEN_FILENAME = "fitbit_tokens.json"

#: The redirect Google sends the browser back to. It has to match the Authorized
#: redirect URI on the Google Cloud OAuth client byte for byte, so it is one constant
#: with one override. `http` is legal here only because Google exempts localhost from
#: its HTTPS rule; any other host must be https.
DEFAULT_REDIRECT_URI = "http://localhost:8000/api/fitbit/callback"

#: The data types this reads, and the key each data point carries its payload under.
#: Weight and body fat are separate data types in Google Health — the Fitbit Web API
#: returned both in one weigh-in record, and that is the single biggest shape change.
WEIGHT_DATA_TYPE = "weight"
BODY_FAT_DATA_TYPE = "body-fat"


def redirect_uri() -> str:
    return os.environ.get("GA_FITBIT_REDIRECT_URI", DEFAULT_REDIRECT_URI).strip()


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class FitbitError(Exception):
    """Anything that went wrong talking to Google Health (or the Fitbit export)."""


class NotConnected(FitbitError):
    """No usable token. The user has to authorise the app."""


class NeedsReauthorization(FitbitError):
    """The refresh token was rejected. Only a fresh consent gets back in.

    Distinct from `NotConnected` because the remedy is the same but the cause is not:
    this one means a cache existed and Fitbit refused it, which is worth saying out
    loud rather than reporting as "not connected yet".
    """


class ProfileNotReady(FitbitError):
    """412. Consent succeeded but the account has no initialised Google Health profile.

    Google's migration guide is explicit that this must not surface as a generic error
    or a blank screen: the user has to open the Google Health app and finish onboarding,
    and the only useful thing to show them is that sentence.
    """

    def __str__(self) -> str:
        return (
            "Your Google Health profile isn't ready yet. Open the Google Health app to "
            "complete setup, then come back and sync."
        )


class MissingConsent(FitbitError):
    """The user approved the sign-in but withheld the permission this app needs.

    Google requires granular consent to be handled rather than crashed on, so this is a
    distinct, nameable state and not a 403 discovered on the first data call.
    """


@dataclass
class RateLimited(FitbitError):
    """429. Google Health allows 300 requests a minute per user and then stops."""

    retry_after_s: int

    def __str__(self) -> str:
        return f"Google Health rate limit reached; it resets in {self.retry_after_s} s"


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
            raise FitbitError(f"Google Health returned something that is not JSON ({exc}).") from exc

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
            raise FitbitError(f"Could not reach Google Health ({exc.reason}).") from exc


# ---------------------------------------------------------------------------
# Credentials and tokens
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Credentials:
    """The app's own identity, from the environment. Never from the database.

    A Web application OAuth client in Google Cloud issues both. They identify the
    *application*, not the person, but the secret is still a secret: it is read once at
    the point of use and never stored, echoed or logged.

    `GOOGLE_HEALTH_*` is the name to use. The old `FITBIT_*` names are still read as a
    fallback so an existing `.env` keeps working, but a Fitbit client id will not
    authenticate against Google and the error when it fails says so.
    """

    client_id: str
    client_secret: str

    #: Checked in order. The first pair that is fully present wins.
    ENV_NAMES = (
        ("GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET"),
        ("FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET"),
    )

    @classmethod
    def _from_environ(cls) -> tuple[str, str]:
        for id_name, secret_name in cls.ENV_NAMES:
            client_id = os.environ.get(id_name, "").strip()
            client_secret = os.environ.get(secret_name, "").strip()
            if client_id and client_secret:
                return client_id, client_secret
        return "", ""

    @classmethod
    def from_env(cls) -> "Credentials":
        client_id, client_secret = cls._from_environ()
        if not client_id or not client_secret:
            raise NotConnected(
                "GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET are not set. "
                "Create a Web application OAuth client in Google Cloud, enable the "
                "Google Health API, and put the pair in the environment."
            )
        return cls(client_id, client_secret)

    @staticmethod
    def configured() -> bool:
        return bool(Credentials._from_environ()[0])

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
    def from_token_response(
        cls,
        payload: Mapping[str, Any],
        now: float,
        fallback_refresh: str = "",
    ) -> "Tokens":
        """Build a token pair from a token-endpoint response.

        `fallback_refresh` is the refresh token already held. **Google does not reissue
        one on every refresh** — unlike Fitbit, which rotates on each call, a Google
        refresh response usually carries only a new access token and the existing
        refresh token stays valid. Treating that as an error would break the very first
        refresh, an hour into the first sync, so the held token carries forward.

        An *authorization-code* exchange with no refresh token is still fatal: it means
        `access_type=offline` was missing and the connection would die within the hour.
        Callers signal that case by passing no fallback.
        """
        access = str(payload.get("access_token") or "")
        refresh = str(payload.get("refresh_token") or "") or fallback_refresh
        if not access or not refresh:
            raise FitbitError(
                "Google returned a token response with no refresh token; a session that "
                "cannot be resumed is not a connection. Check that the consent URL "
                "carried access_type=offline."
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

    The padding matters. Google compares the challenge it stored against the one it
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
            # Without `offline` Google issues an access token and no refresh token, and
            # the connection silently dies an hour later. It is the single easiest way
            # to get this flow wrong.
            "access_type": "offline",
            # Force the consent screen. Google only returns a refresh token on the
            # first grant, so a re-connect after a lost cache gets nothing back unless
            # consent is asked for again.
            "prompt": "consent",
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
        "No authorization code in that text. After approving, the address bar "
        "contains `?code=…` — paste that whole URL."
    )


def _form(body: Mapping[str, str]) -> bytes:
    return urllib.parse.urlencode(body).encode("ascii")


def _token_request(
    creds: Credentials,
    body: Mapping[str, str],
    transport: Transport,
    now: float,
    fallback_refresh: str = "",
) -> Tokens:
    # Google's token endpoint takes the client secret as a form field, not as an HTTP
    # Basic header. Sending Basic instead gets an `invalid_client` that says nothing
    # about which half of the credential it disliked.
    payload_body = dict(body)
    payload_body["client_secret"] = creds.client_secret
    response = transport.request(
        "POST",
        TOKEN_URL,
        {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        _form(payload_body),
    )
    if response.status >= 400:
        raise _auth_error(response)
    payload = response.json()
    if not isinstance(payload, Mapping):
        raise FitbitError("Google's token endpoint returned something unexpected.")
    return Tokens.from_token_response(payload, now, fallback_refresh)


def exchange_code(
    creds: Credentials,
    pending: PendingAuthorization,
    code: str,
    transport: Transport,
    now: float | None = None,
) -> Tokens:
    """Trade the authorization code for the first pair of tokens.

    The code is valid for ten minutes and once. `redirect_uri` has to be byte-identical
    to the one in the consent URL or Google rejects the exchange — which is why it is
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
    """Swap the refresh token for a fresh access token.

    **Google usually does not rotate the refresh token.** Fitbit did, and the old code
    was built around that: the response carried a new one and the old one died at once.
    Google normally returns only a new access token, so the held refresh token is passed
    as the fallback and carries forward.

    It *may* still return one — the documented response shows `refresh_token` and
    `refresh_token_expires_in` — so callers keep writing the result to the cache before
    doing anything else with it. Carrying forward and rotating both work; assuming
    either is what breaks.
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
        fallback_refresh=tokens.refresh_token,
    )


def granted_health_scopes(scope: str) -> set[str]:
    """The Google Health scopes actually granted, out of a token response's `scope`.

    Consent is granular: the user can approve the sign-in and withhold the permission.
    The token is still issued, so the only place this is visible is the scope string.
    """
    return {s for s in (scope or "").split() if s.startswith(_HEALTH_SCOPE_PREFIX)}


def require_consent(tokens: Tokens) -> None:
    """Fail loudly, and nameably, when the grant carries no Google Health permission."""
    if not granted_health_scopes(tokens.scope):
        raise MissingConsent(
            "The sign-in completed but no Google Health permission was granted. At "
            "least one is required to read your weigh-ins — connect again and leave "
            "the health metrics permission ticked."
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
            f"Google would not issue a token ({detail}). Authorise the app again — a "
            "code is single-use and expires in ten minutes, and a refresh token that "
            "has been rotated is already spent."
        )
    return FitbitError(f"Google's token endpoint failed ({detail}).")


def retry_after(response: Response) -> int:
    """How long to wait before trying again, in seconds.

    Google Health's per-user limit is 300 requests a minute, so the fallback is a
    minute rather than Fitbit's hour. `Retry-After` is honoured when sent; the legacy
    `fitbit-rate-limit-reset` is still read because a proxy in front of the old API
    may yet emit it and ignoring a correct answer to guess a worse one is silly.
    """
    for header in ("retry-after", "fitbit-rate-limit-reset"):
        raw = response.header(header)
        if raw and raw.strip().isdigit():
            return int(raw.strip())
    return 60


def rate_limit_remaining(response: Response) -> int | None:
    """Calls left in the window, when the service says. Google usually does not."""
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

        The proactive expiry check is not enough on its own: access can be revoked from
        the Google Account page at any moment, and the clock in a container can be
        wrong. So a 401 is retried once after a refresh, and a second 401 is reported
        rather than looped on.
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
                f"Google rejected the refreshed token ({error_message(response)}). "
                "The app's access was probably revoked; authorise it again."
            )
        if response.status == 412:
            # Consent worked but the account has no Google Health profile yet. Its own
            # error type, because the remedy is in a different app entirely.
            raise ProfileNotReady()
        if response.status == 403:
            raise MissingConsent(
                f"Google Health refused {path} ({error_message(response)}). The health "
                "metrics permission was probably withheld; connect again and grant it."
            )
        if response.status >= 400:
            raise FitbitError(f"Google Health refused {path} ({error_message(response)}).")
        return response.json()

    def _authorised_get(self, path: str) -> Response:
        url = path if path.startswith("http") else f"{API_ROOT}/{path.lstrip('/')}"
        response = self.transport.request(
            "GET",
            url,
            {
                "Authorization": f"Bearer {self.tokens.access_token}",
                "Accept": "application/json",
                # No Accept-Language. The old API returned whatever unit the account's
                # locale implied, so the header was load-bearing; Google Health answers
                # in `weightGrams` and the question no longer exists.
            },
        )
        seen = rate_limit_remaining(response)
        if seen is not None:
            self.remaining = seen
        return response

    def identity(self) -> Mapping[str, Any]:
        """Both user ids for this token: Google's `healthUserId` and Fitbit's legacy one.

        Google's migration guide recommends calling this as soon as a user consents and
        storing both, so records keyed by the old six-character Fitbit id can still be
        matched after the cutover. It is also the cheapest possible probe of whether
        the profile exists at all — it is what returns 412 when it does not.
        """
        payload = self.get("/users/me/identity")
        return payload if isinstance(payload, Mapping) else {}

    def display_name(self) -> str:
        """Which account is connected. The health user id; there is no name endpoint."""
        return str(self.identity().get("healthUserId") or "")

    def data_points(
        self,
        data_type: str,
        filter_expr: str | None = None,
        page_size: int = 1000,
    ) -> list[Mapping[str, Any]]:
        """Every data point of one type, following `nextPageToken` to the end.

        The Fitbit Web API paged by date window because it had no cursor and a 150/hour
        budget; Google Health pages by token and allows 300 requests a minute, so the
        whole history is a handful of calls rather than 36 carefully spaced ones.

        An empty `nextPageToken` and an absent one both mean the end. A token that
        repeats itself would mean an infinite loop, so it is checked for rather than
        trusted.
        """
        collected: list[Mapping[str, Any]] = []
        token = ""
        seen_tokens: set[str] = set()
        while True:
            params: dict[str, str] = {"pageSize": str(page_size)}
            if filter_expr:
                params["filter"] = filter_expr
            if token:
                params["pageToken"] = token
            query = urllib.parse.urlencode(params)
            payload = self.get(f"/users/me/dataTypes/{data_type}/dataPoints?{query}")
            if not isinstance(payload, Mapping):
                break
            page = payload.get("dataPoints")
            if isinstance(page, list):
                collected.extend(p for p in page if isinstance(p, Mapping))
            token = str(payload.get("nextPageToken") or "")
            if not token:
                break
            if token in seen_tokens:
                log.warning("Google Health repeated a page token for %s; stopping.", data_type)
                break
            seen_tokens.add(token)
        return collected


def connected_account(token_dir: Path) -> str:
    """The stored user id, without a network call. Empty when not connected."""
    try:
        tokens = load_tokens(Path(token_dir))
    except NeedsReauthorization:
        return ""
    return tokens.user_id if tokens else ""
