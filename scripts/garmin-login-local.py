#!/usr/bin/env python3
"""Log in to Garmin from a machine Garmin will talk to, and save the token cache.

Why this exists: Garmin's SSO login route (`sso.garmin.com/mobile/api/login`) returns
429 to datacenter and VPS address ranges regardless of credentials — a fresh install
on a rented server cannot log in at all, while the *data* endpoints on
`connectapi.garmin.com` answer that same server perfectly well.

So: log in from home, carry the tokens over. Run this on a laptop or phone-tethered
machine on a residential connection:

    python3 -m pip install --user 'garth==0.8.0'
    python3 garmin-login-local.py

It writes an `oauth1_token.json` (valid about a year) and an `oauth2_token.json`
(short-lived, refreshed automatically against connectapi, which is not blocked) into
a directory you then copy to the server. See scripts/install-tokens.sh.

Your password is read with getpass — never echoed, never stored, never in shell
history. It is used for the one token exchange and then discarded.
"""

from __future__ import annotations

import getpass
import os
import sys

DEFAULT_OUT = os.path.expanduser("~/garmin-tokens")


def main() -> int:
    try:
        import garth
    except ImportError:
        print("garth is not installed. Run:  python3 -m pip install --user 'garth==0.8.0'",
              file=sys.stderr)
        return 1

    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT

    print("Garmin Connect login (tokens will be written to %s)\n" % out)
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (not echoed): ")

    def prompt_mfa() -> str:
        return input("MFA code from your authenticator or email: ").strip()

    try:
        garth.login(email, password, prompt_mfa=prompt_mfa)
    except Exception as exc:                                  # garth raises several types
        print(f"\nLogin failed: {exc}", file=sys.stderr)
        print("If this says 429 here too, this machine is also on a range Garmin "
              "throttles — try a phone hotspot.", file=sys.stderr)
        return 1
    finally:
        del password

    os.makedirs(out, exist_ok=True)
    os.chmod(out, 0o700)
    garth.save(out)

    print(f"\nSaved: {', '.join(sorted(os.listdir(out)))}")
    print(f"\nNow copy them to the server and install them:\n"
          f"    scp -r {out} shinzy@100.64.137.3:/tmp/garmin-tokens\n"
          f"    ssh shinzy@100.64.137.3 '~/garmin-analytics/scripts/install-tokens.sh "
          f"/tmp/garmin-tokens'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
