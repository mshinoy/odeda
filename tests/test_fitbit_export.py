"""The Fitbit data export, against ZIPs the tests build themselves.

No credential, no network, no rate limit — which is exactly why this path exists. It is
the fallback if Google retires the Web API, the fastest way to load a decade of history,
and the only thing that works before an app has been registered at all.

Two traps carry most of these tests, because both produce numbers that look right.

**Dates.** `03/01/19` in a Fitbit export is 1 March 2019. Read as day-first it is
3 January — a plausible date, in the right year, wrong by two months, and nothing
downstream can tell.

**Units.** The export follows the account's original unit setting and does not say
which it used. 75 and 175 are both plausible weights for a person, so the number alone
decides nothing. The record's own BMI does: weight and BMI imply a height, and a weight
in pounds implies one around 2.6 m.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from pathlib import Path

import pytest

from garmin_analytics.ingest import fitbit_export as FE


def build_zip(tmp_path: Path, members: dict[str, object], name: str = "takeout.zip") -> Path:
    """A Takeout archive, written here rather than committed.

    A real export is megabytes of someone's personal history; this repository is
    public-bound and holds no such thing.
    """
    path = tmp_path / name
    with zipfile.ZipFile(path, "w") as zf:
        for member, body in members.items():
            zf.writestr(member, body if isinstance(body, str) else json.dumps(body))
    return path


def weight_json(*records) -> list[dict]:
    return list(records)


def metric_record(date: str, kg: float, *, fat=18.2, time="07:38:14") -> dict:
    """A record as the export writes it, with a BMI consistent with a 1.79 m athlete."""
    return {
        "logId": 1553067494000,
        "weight": kg,
        "bmi": round(kg / (1.79**2), 2),
        "date": date,
        "time": time,
        "source": "Aria",
        "fat": fat,
    }


def imperial_record(date: str, lb: float, **kw) -> dict:
    """The same reading in pounds — with the BMI still computed from kilograms, which
    is what the export actually does and what makes the inference possible."""
    record = metric_record(date, lb * FE.KG_PER_LB, **kw)
    record["weight"] = lb
    return record


# ---------------------------------------------------------------------------


class TestDates:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("2019-03-01", "2019-03-01"),
            ("2019-03-01T07:38:14", "2019-03-01"),
            ("03/01/19", "2019-03-01"),
            ("03/01/2019", "2019-03-01"),
            ("3/1/19", "2019-03-01"),
            ("12/31/22", "2022-12-31"),
        ],
    )
    def test_every_format_the_export_has_used(self, raw, expected):
        assert FE.to_iso_date(raw) == expected

    def test_a_first_field_above_twelve_can_only_be_a_day(self):
        """Some locales' exports do write day-first. 25 is not a month, so this one is
        knowable — and a silently transposed date survives for years because every
        value it produces looks fine."""
        assert FE.to_iso_date("25/12/22") == "2022-12-25"

    @pytest.mark.parametrize("raw", ["", None, "yesterday", "13/45/99"])
    def test_nothing_readable_is_none_rather_than_a_guess(self, raw):
        assert FE.to_iso_date(raw) is None


class TestUnits:
    def test_kilograms_are_recognised(self):
        records = [metric_record("2019-03-0%d" % d, 76.0 + d) for d in range(1, 6)]
        assert FE.looks_like_pounds(records) is False

    def test_pounds_are_recognised(self):
        """A 168 lb reading with a BMI of 23.6 implies a 2.67 m athlete. Nobody is
        2.67 m, so the weight is not kilograms."""
        records = [imperial_record("2019-03-0%d" % d, 168.0 + d) for d in range(1, 6)]
        assert FE.looks_like_pounds(records) is True
        assert FE.implied_height_m(168.0, 23.57) > FE.MAX_HEIGHT_M

    def test_one_broken_record_cannot_convert_a_decade(self):
        """Majority vote, because a single BMI of 0 should not turn every weight in the
        file into pounds."""
        records = [metric_record("2019-03-0%d" % d, 76.0) for d in range(1, 6)]
        records.append({**metric_record("2019-03-06", 76.0), "bmi": 0})
        assert FE.looks_like_pounds(records) is False

    def test_nothing_decidable_keeps_the_documented_default(self):
        """No BMI means no evidence. Metric is what Fitbit documents, so metric it is —
        inventing a conversion on no evidence is worse than not converting."""
        assert FE.looks_like_pounds([{"weight": 76.0, "date": "2019-03-01"}]) is False

    def test_a_pound_is_exactly_the_international_pound(self):
        assert FE.KG_PER_LB == 0.45359237


class TestImporting:
    def test_it_finds_weight_wherever_takeout_put_it(self, tmp_path, store):
        """Routed by shape, not by path: Takeout's directory names have already changed
        twice, and a renamed folder must cost nothing."""
        path = build_zip(
            tmp_path,
            {
                "Takeout/Fitbit/Global Export Data/weight-2019-03-01.json": weight_json(
                    metric_record("03/01/19", 76.4),
                    metric_record("03/08/19", 76.0),
                ),
                "Takeout/archive_browser.html": "<html>not data</html>",
            },
        )
        result = FE.import_fitbit_export(store, path)

        assert result["written"] == 2
        assert result["units_found"] == ["kg"]
        rows = store.query("SELECT day, weight_kg, body_fat_pct FROM body_composition ORDER BY day")
        assert [r["day"] for r in rows] == ["2019-03-01", "2019-03-08"]
        assert rows[0]["weight_kg"] == 76.4

    def test_a_document_is_archived_before_it_is_parsed(self, tmp_path, store):
        """Raw-first. Correcting a parsing mistake must never mean asking Google for the
        export again, which takes days."""
        member = "Takeout/Fitbit/Global Export Data/weight-2019-03-01.json"
        path = build_zip(tmp_path, {member: weight_json(metric_record("03/01/19", 76.4))})
        FE.import_fitbit_export(store, path)

        raw = store.raw_documents(FE.ENDPOINT)
        assert len(raw) == 1
        assert raw[0]["source"] == "fitbit_export"
        assert raw[0]["ref_key"] == member
        assert store.scalar("SELECT COUNT(*) FROM body_composition WHERE raw_id IS NULL") == 0

    def test_pounds_are_converted_on_the_way_in(self, tmp_path, store):
        path = build_zip(
            tmp_path,
            {
                "Fitbit/weight-2019.json": weight_json(
                    imperial_record("03/01/19", 168.4),
                    imperial_record("03/08/19", 167.1),
                )
            },
        )
        result = FE.import_fitbit_export(store, path)
        assert result["units_found"] == ["lb"]
        # 168.4 lb x 0.45359237 = 76.38 kg, to the two decimals the column stores.
        assert store.scalar(
            "SELECT weight_kg FROM body_composition WHERE day = '2019-03-01'"
        ) == 76.38

    def test_the_csv_form_works_too(self, tmp_path, store):
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["Date", "Weight", "BMI", "Fat", "Time", "Log ID"])
        writer.writerow(["03/01/19", "76.4", "23.85", "18.2", "07:38:14", "1553067494000"])
        path = build_zip(tmp_path, {"Fitbit/weight.csv": buffer.getvalue()})

        assert FE.import_fitbit_export(store, path)["written"] == 1
        assert store.scalar(
            "SELECT weight_kg FROM body_composition WHERE day = '2019-03-01'"
        ) == 76.4

    def test_the_earliest_reading_of_a_day_still_wins(self, tmp_path, store):
        """D5 is enforced by the shared normaliser, so the export cannot disagree with
        the live sync about which reading of a day counts."""
        path = build_zip(
            tmp_path,
            {
                "Fitbit/weight.json": weight_json(
                    metric_record("03/01/19", 77.6, time="21:04:00"),
                    metric_record("03/01/19", 76.4, time="06:55:00"),
                )
            },
        )
        FE.import_fitbit_export(store, path)
        assert store.scalar(
            "SELECT weight_kg FROM body_composition WHERE day = '2019-03-01'"
        ) == 76.4

    def test_importing_twice_writes_the_same_thing(self, tmp_path, store):
        path = build_zip(tmp_path, {"Fitbit/weight.json": weight_json(metric_record("03/01/19", 76.4))})
        FE.import_fitbit_export(store, path)
        FE.import_fitbit_export(store, path)
        assert store.scalar("SELECT COUNT(*) FROM body_composition") == 1
        assert len(store.raw_documents(FE.ENDPOINT)) == 1

    def test_the_export_does_not_move_the_live_syncs_resume_cursor(self, tmp_path, store):
        """A ZIP's coverage is not a day the sync has reached. Writing one into
        `fitbit_body` would send the next sync back to the start of the account."""
        from garmin_analytics.ingest import fitbit_sync as FS

        store.set_watermark(FS.ENDPOINT, "2026-06-30", "ok", None)
        path = build_zip(tmp_path, {"Fitbit/weight.json": weight_json(metric_record("03/01/19", 76.4))})
        FE.import_fitbit_export(store, path)

        assert store.get_watermark(FS.ENDPOINT) == "2026-06-30"
        assert store.get_watermark(FE.WATERMARK) is None
        note = [w for w in store.watermarks() if w["endpoint"] == FE.WATERMARK][0]
        assert "1 weigh-ins" in str(note["note"])

    def test_documents_with_no_weight_in_them_are_reported_not_failed(self, tmp_path, store):
        path = build_zip(
            tmp_path,
            {
                "Fitbit/sleep-2019.json": [{"logId": 1, "duration": 2700000}],
                "Fitbit/weight.json": weight_json(metric_record("03/01/19", 76.4)),
            },
        )
        result = FE.import_fitbit_export(store, path)
        assert result["written"] == 1
        assert result["unrecognised_count"] == 1
        assert "Fitbit/sleep-2019.json" in result["unrecognised"]

    def test_an_undecodable_member_does_not_abort_the_import(self, tmp_path, store):
        path = build_zip(
            tmp_path,
            {
                "Fitbit/broken.json": "{not json at all",
                "Fitbit/weight.json": weight_json(metric_record("03/01/19", 76.4)),
            },
        )
        result = FE.import_fitbit_export(store, path)
        assert result["written"] == 1
        assert result["undecodable_count"] == 1

    def test_an_implausible_weight_is_dropped_rather_than_stored(self, tmp_path, store):
        """A column read as the wrong thing entirely, not an unusual athlete. Six
        thousand kilograms on the Health page would be the chart's whole y axis."""
        path = build_zip(
            tmp_path,
            {"Fitbit/weight.json": weight_json({**metric_record("03/01/19", 76.4), "weight": 6000})},
        )
        assert FE.import_fitbit_export(store, path)["written"] == 0

    def test_a_missing_file_says_so(self, store, tmp_path):
        with pytest.raises(FileNotFoundError):
            FE.import_fitbit_export(store, tmp_path / "nothing.zip")

    def test_the_command_parses(self):
        from garmin_analytics import cli

        args = cli.build_parser().parse_args(["import-fitbit", "takeout.zip"])
        assert args.path == "takeout.zip" and callable(args.func)
