"""Command line: login | sync | import-zip | import-fit | seed | serve | doctor | report.

Credential handling rule, enforced here: the password is read with `getpass` from a tty
and passed straight to `garth`. It is never an argument, never an environment variable
read by this program, never echoed, and never written anywhere.
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Sequence

from . import __version__
from .config import load_settings

log = logging.getLogger("garmin_analytics")

GREEN, YELLOW, RED, DIM, BOLD, RESET = (
    "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"
)
STATUS_COLOUR = {"ok": GREEN, "warn": YELLOW, "fail": RED}


def _colour(text: str, code: str, enabled: bool) -> str:
    return f"{code}{text}{RESET}" if enabled else text


def _store():
    from .db.store import Store

    return Store.open(load_settings())


def _emit(data: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(data, indent=2, default=str))


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_login(args: argparse.Namespace) -> int:
    from .ingest import connect

    settings = load_settings()
    email = args.email or input("Garmin Connect email: ").strip()
    if not sys.stdin.isatty() and not args.allow_non_tty:
        print(
            "Refusing to read a password from a non-tty. Run this in a terminal.",
            file=sys.stderr,
        )
        return 2
    password = getpass.getpass("Garmin Connect password (not stored, not echoed): ")
    try:
        connect.login(email, password, settings.token_dir)
    finally:
        del password  # not a security guarantee, just not leaving it lying around
    user = connect.resume(settings.token_dir)
    print(f"Logged in as {user}. Token cache written to {settings.token_dir} (mode 0600).")
    print("Next: garmin-analytics sync --days 540")
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    from .ingest import connect

    settings = load_settings()
    end = date.fromisoformat(args.end) if args.end else date.today()
    with _store() as st:
        try:
            user = connect.resume(settings.token_dir)
        except connect.NotAuthenticated as exc:
            print(str(exc), file=sys.stderr)
            return 2
        print(f"Syncing as {user}, through {end}. Ctrl-C is safe: every write is committed "
              f"per endpoint.")

        def progress(endpoint: str, detail: str) -> None:
            print(f"  {endpoint:<20} {detail}", end="\r", flush=True)

        results = connect.sync(
            st,
            settings,
            days=args.days,
            end=end,
            endpoints=args.endpoints.split(",") if args.endpoints else None,
            include_activities=not args.no_activities,
            user=user,
            on_progress=progress if not args.quiet else None,
        )
        print()
        for r in results:
            print(f"  {r['endpoint']:<20} fetched={r.get('fetched', '-'):<6} "
                  f"written={r.get('written', r.get('zones', 0))}")
        if not args.no_best_efforts:
            from .analytics import performance

            n = performance.rebuild_best_efforts(st)
            print(f"  best efforts rebuilt: {n}")
    _emit(results, args.json)
    return 0


def cmd_renormalize(args: argparse.Namespace) -> int:
    from .ingest import connect

    with _store() as st:
        counts = connect.renormalize(st)
    for k, v in counts.items():
        print(f"  {k:<20} {v}")
    _emit(counts, args.json)
    return 0


def cmd_import_zip(args: argparse.Namespace) -> int:
    from .ingest import export_zip

    with _store() as st:
        result = export_zip.import_zip(st, args.path)
        from .analytics import performance

        performance.rebuild_best_efforts(st)
    print(f"Scanned {result['members_scanned']} JSON members from {result['zip']}")
    for k, v in sorted(result["written"].items()):
        print(f"  {k:<20} {v}")
    if result["unrecognised_count"]:
        print(f"  {result['unrecognised_count']} documents archived raw but not recognised "
              f"(they are still in raw_documents)")
    _emit(result, args.json)
    return 0


def cmd_import_fit(args: argparse.Namespace) -> int:
    from .ingest import fitfile

    paths: list[Path] = []
    for raw in args.paths:
        p = Path(raw)
        paths.extend(sorted(p.rglob("*.fit")) if p.is_dir() else [p])
    if not paths:
        print("No .fit files found.", file=sys.stderr)
        return 1

    results = []
    with _store() as st:
        for p in paths:
            try:
                results.append(fitfile.import_fit_file(st, p, args.tz_offset))
            except Exception as exc:  # one bad file must not abort a bulk import
                results.append({"file": p.name, "imported": False, "reason": str(exc)})
    ok = sum(1 for r in results if r.get("imported"))
    print(f"Imported {ok}/{len(results)} FIT files")
    for r in results:
        if not r.get("imported"):
            print(f"  skipped {r['file']}: {r.get('reason')}")
    _emit(results, args.json)
    return 0 if ok else 1


def cmd_seed(args: argparse.Namespace) -> int:
    from .seed.synthetic import seed_database

    settings = load_settings()
    end = date.fromisoformat(args.end) if args.end else date.today()
    with _store() as st:
        if not args.reset and st.scalar("SELECT COUNT(*) FROM activities"):
            print(
                "Database already holds activities. Re-run with --reset to wipe and reseed, "
                "or point GA_DB at a scratch file.",
                file=sys.stderr,
            )
            return 1
        print(f"Seeding {args.months} months of synthetic data ending {end} into "
              f"{settings.db_path} ...")
        counts = seed_database(st, end=end, months=args.months, reset=args.reset)
    print(
        f"  days={counts['days']}  activities={counts['activities']}  "
        f"samples={counts['samples']}  raw_documents={counts['raw']}  "
        f"best_efforts={counts['best_efforts']}"
    )
    print("  This data is SYNTHETIC. `doctor` and the dashboard both say so.")
    _emit(counts, args.json)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    settings = load_settings()
    if not settings.db_path.exists():
        print(
            f"No database at {settings.db_path}. Run `garmin-analytics seed` or `sync` first.",
            file=sys.stderr,
        )
        return 1
    print(f"Dashboard: http://{args.host}:{args.port}/   (db: {settings.db_path})")
    uvicorn.run(
        "garmin_analytics.api.server:create_app",
        factory=True,
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=args.log_level,
    )
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    from .diagnostics import run_doctor

    result = run_doctor(load_settings())
    if args.json:
        print(json.dumps(result, indent=2, default=str))
        return 0 if result["overall"] != "fail" else 1

    colour = sys.stdout.isatty()
    print(_colour(f"garmin-analytics {result['version']} — doctor", BOLD, colour))
    for c in result["checks"]:
        mark = {"ok": "ok  ", "warn": "warn", "fail": "FAIL"}[c["status"]]
        print(f"  [{_colour(mark, STATUS_COLOUR[c['status']], colour)}] "
              f"{c['check']:<18} {c['detail']}")
    print(f"\noverall: {_colour(result['overall'], STATUS_COLOUR[result['overall']], colour)}")
    return 0 if result["overall"] != "fail" else 1


def cmd_report(args: argparse.Namespace) -> int:
    """Print the things you'd actually want in a terminal, without opening a browser."""
    from .analytics import load as load_mod
    from .analytics import readiness as ready_mod
    from .analytics import reports as reports_mod

    with _store() as st:
        rd = ready_mod.compute_readiness(st)
        ld = load_mod.compute_load(st)
        race = ready_mod.compute_race(st)
        rep = reports_mod.compute_reports(st)

    if args.json:
        print(json.dumps(
            {"readiness": rd, "load": ld.get("current"), "race": race, "reports": rep},
            indent=2, default=str,
        ))
        return 0

    colour = sys.stdout.isatty()
    print(_colour(f"\n{rd['day']}  readiness {rd['score']} ({rd['band']})", BOLD, colour))
    for reason in rd["reasons"]:
        print(f"    · {reason}")
    print(f"    → {rd['recommendation']}")

    cur = ld.get("current") or {}
    print(_colour("\ntraining load", BOLD, colour))
    print(f"    CTL {cur.get('ctl')}   ATL {cur.get('atl')}   TSB {cur.get('tsb')}  "
          f"({cur.get('form')})")
    print(f"    CTL ramp {ld.get('ramp_pct')}%/wk"
          + ("  ** above the 10% flag **" if ld.get("ramp_flag") else ""))

    print(_colour(f"\n{race['race']['name']}", BOLD, colour))
    print(f"    {race['race']['date']} — {race['days_to_go']} days to go")
    if race["projection"]:
        p = race["projection"]
        print(f"    projected {p['projected_time']} ({p['projected_pace']}) "
              f"from {p['from_label']} {p['from_time']} on {p['from_day']}")
    for note in race["notes"]:
        print(f"    · {note}")

    print(_colour("\nlast 4 weeks", BOLD, colour))
    print(f"    {'week':<10}{'runs':>5}{'km':>8}{'trimp':>8}{'rhr':>7}{'hrv':>7}{'sleep':>7}")
    for w in rep["weekly"][-4:]:
        print(f"    {w['week']:<10}{w['runs']:>5}{w['run_km']:>8}{w['trimp']:>8}"
              f"{w['rhr'] or '-':>7}{w['hrv'] or '-':>7}{w['sleep_h'] or '-':>7}")
    print()
    return 0


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="garmin-analytics",
        description="Personal analytics over Garmin Connect data.",
    )
    p.add_argument("--version", action="version", version=f"garmin-analytics {__version__}")
    p.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    sub = p.add_subparsers(dest="command", required=True)

    def add(name: str, fn, help_: str) -> argparse.ArgumentParser:
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("--json", action="store_true", help="machine-readable output")
        sp.set_defaults(func=fn)
        return sp

    sp = add("login", cmd_login, "authenticate with Garmin Connect (once)")
    sp.add_argument("--email")
    sp.add_argument("--allow-non-tty", action="store_true",
                    help="permit a piped password (you probably do not want this)")

    sp = add("sync", cmd_sync, "incremental pull from Garmin Connect")
    sp.add_argument("--days", type=int, default=540,
                    help="how far back to go on a first sync (default 540)")
    sp.add_argument("--end", help="last day to sync, ISO date (default today)")
    sp.add_argument("--endpoints", help="comma-separated subset, e.g. sleep,hrv")
    sp.add_argument("--no-activities", action="store_true")
    sp.add_argument("--no-best-efforts", action="store_true")
    sp.add_argument("--quiet", action="store_true")

    add("renormalize", cmd_renormalize,
        "re-parse everything already archived in raw_documents (no network)")

    sp = add("import-zip", cmd_import_zip, "load Garmin's official data-export ZIP")
    sp.add_argument("path")

    sp = add("import-fit", cmd_import_fit, "load .fit files or a directory of them")
    sp.add_argument("paths", nargs="+")
    sp.add_argument("--tz-offset", type=float, default=3.0,
                    help="local hours ahead of UTC (default 3.0 for Asia/Qatar)")

    sp = add("seed", cmd_seed, "generate synthetic data for demos and tests")
    sp.add_argument("--months", type=int, default=18)
    sp.add_argument("--end", help="last day, ISO date (default today)")
    sp.add_argument("--reset", action="store_true", help="wipe existing rows first")

    sp = add("serve", cmd_serve, "run the API and dashboard")
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8808)
    sp.add_argument("--reload", action="store_true")
    sp.add_argument("--log-level", default="info")

    add("doctor", cmd_doctor, "report environment and data status")
    add("report", cmd_report, "print today's readiness, load and race outlook")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
