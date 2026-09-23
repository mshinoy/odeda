"""Ingestion: normalisers, the Connect sync loop, FIT parsing and the export ZIP.

Important caveat, stated in the code because it matters: **the live Garmin SSO path is
not exercised anywhere in this suite.** There are no credentials on this machine. What
is tested is everything downstream of the HTTP call — the sync loop is driven through an
injected `fetcher`, and the normalisers run against handcrafted payloads in fixtures.py.
The FIT path *is* end-to-end: tests/fitgen.py writes a real FIT binary that the real
`fitdecode` parses.
"""

from __future__ import annotations

import datetime as dt
import json
import zipfile
from pathlib import Path

import pytest

import fitgen
import fixtures as F
from garmin_analytics.ingest import connect, export_zip, fitfile
from garmin_analytics.ingest import normalize as N


class TestPick:
    def test_first_present_wins(self):
        assert N.pick({"b": 2, "a": 1}, "a", "b") == 1
        assert N.pick({"b": 2}, "a", "b") == 2

    def test_dotted_paths(self):
        assert N.pick({"a": {"b": {"c": 3}}}, "a.b.c") == 3

    def test_missing_returns_default(self):
        assert N.pick({"a": 1}, "z", default="fallback") == "fallback"
        assert N.pick(None, "a") is None

    def test_none_is_treated_as_absent(self):
        assert N.pick({"a": None, "b": 2}, "a", "b") == 2

    def test_dotted_path_through_a_non_mapping(self):
        assert N.pick({"a": 5}, "a.b.c") is None


class TestCoercion:
    @pytest.mark.parametrize("value, expect", [("12.5", 12.5), (3, 3.0), (None, None),
                                               ("", None), ("abc", None), (True, None)])
    def test_as_float(self, value, expect):
        assert N.as_float(value) == expect

    def test_as_float_drops_nan(self):
        assert N.as_float(float("nan")) is None

    @pytest.mark.parametrize("value, expect", [(12.6, 13), ("7", 7), (None, None)])
    def test_as_int(self, value, expect):
        assert N.as_int(value) == expect

    def test_iso_local_from_space_separated(self):
        assert N.iso_local("2026-09-20 05:42:11") == "2026-09-20T05:42:11"

    def test_iso_local_from_epoch_millis(self):
        assert N.iso_local(1789883931000).startswith("2026-09-20T")

    def test_iso_local_empty(self):
        assert N.iso_local("") is None and N.iso_local(None) is None

    def test_iso_utc_adds_the_z(self):
        assert N.iso_utc("2026-09-20 02:42:11") == "2026-09-20T02:42:11Z"

    def test_day_of(self):
        assert N.day_of("2026-09-20T05:42:11") == "2026-09-20"
        assert N.day_of(None) is None


class TestNormalizeActivity:
    def test_flat_api_shape(self):
        row = N.normalize_activity(F.ACTIVITY)
        assert row["activity_id"] == "987654321"
        assert row["day"] == "2026-09-20"
        assert row["start_time_local"] == "2026-09-20T05:42:11"
        assert row["start_time_utc"] == "2026-09-20T02:42:11Z"
        assert row["activity_type"] == "running"
        assert row["distance_m"] == pytest.approx(12043.28)
        assert row["moving_time_s"] == pytest.approx(3688.0)
        assert row["avg_hr"] == 152.0
        assert row["avg_cadence_spm"] == pytest.approx(173.4)
        assert row["training_effect_aerobic"] == pytest.approx(3.6)

    def test_nested_summary_dto_shape(self):
        row = N.normalize_activity(F.ACTIVITY_NESTED)
        assert row["distance_m"] == 8000.0
        assert row["avg_hr"] == 148.0
        assert row["elevation_gain_m"] == 210.0

    def test_trail_running_maps_to_running(self):
        assert N.normalize_activity(F.ACTIVITY_NESTED)["activity_type"] == "running"

    def test_unknown_sport_falls_back_to_other(self):
        row = N.normalize_activity({"activityId": 1, "startTimeLocal": "2026-01-01 00:00:00",
                                    "activityType": {"typeKey": "underwater_basket_weaving"}})
        assert row["activity_type"] == "other"

    def test_sparse_activity_does_not_raise(self):
        row = N.normalize_activity(F.ACTIVITY_SPARSE)
        assert row["activity_id"] == "222"
        assert row["distance_m"] is None
        assert row["avg_hr"] is None
        assert row["activity_type"] == "strength_training"

    def test_average_speed_is_derived_when_missing(self):
        row = N.normalize_activity({
            "activityId": 3, "startTimeLocal": "2026-01-01 06:00:00",
            "activityType": {"typeKey": "running"}, "distance": 10000.0, "duration": 3000.0,
        })
        assert row["avg_speed_mps"] == pytest.approx(10000.0 / 3000.0)

    def test_moving_time_falls_back_to_duration(self):
        assert N.normalize_activity(F.ACTIVITY_SPARSE)["moving_time_s"] == 2400.0

    def test_empty_payload_is_survivable(self):
        row = N.normalize_activity({})
        assert row["activity_id"] == "" and row["day"] is None


class TestNormalizeHrZones:
    def test_hand_checked_totals(self):
        zones = N.normalize_hr_zones(F.HR_ZONES)
        assert zones == {1: 245.0, 2: 1180.0, 3: 1660.0, 4: 520.0, 5: 83.0}
        assert sum(zones.values()) == pytest.approx(3688.0)

    def test_alternative_key_spellings(self):
        assert N.normalize_hr_zones([{"zoneNum": 2, "secondsInZone": 60}]) == {2: 60.0}

    def test_out_of_range_zones_are_dropped(self):
        assert N.normalize_hr_zones([{"zoneNumber": 0, "secsInZone": 60},
                                     {"zoneNumber": 6, "secsInZone": 60}]) == {}

    def test_duplicate_zones_accumulate(self):
        assert N.normalize_hr_zones([{"zoneNumber": 2, "secsInZone": 60},
                                     {"zoneNumber": 2, "secsInZone": 40}]) == {2: 100.0}

    @pytest.mark.parametrize("payload", [None, {}, "not a list", [None, 5]])
    def test_junk_input_is_empty_not_an_exception(self, payload):
        assert N.normalize_hr_zones(payload) == {}


class TestNormalizeSleep:
    def test_full_payload(self):
        row = N.normalize_sleep(F.SLEEP)
        assert row["day"] == "2026-09-20"
        assert row["total_sleep_s"] == 26580
        assert row["deep_s"] == 4980
        assert row["rem_s"] == 5340
        assert row["sleep_score"] == 78
        assert row["overnight_hrv_ms"] == 61.0
        assert row["avg_respiration_brpm"] == pytest.approx(13.8)
        assert row["bedtime_local"] == "2026-09-19T22:41:00"
        assert row["waketime_local"] == "2026-09-20T06:14:00"

    def test_stages_sum_to_roughly_the_total(self):
        row = N.normalize_sleep(F.SLEEP)
        assert row["deep_s"] + row["light_s"] + row["rem_s"] == row["total_sleep_s"]

    def test_device_without_a_sleep_score(self):
        row = N.normalize_sleep(F.SLEEP_MINIMAL)
        assert row["day"] == "2026-09-19"
        assert row["sleep_score"] is None
        assert row["total_sleep_s"] == 24000

    def test_day_argument_is_used_when_the_payload_omits_it(self):
        row = N.normalize_sleep({"dailySleepDTO": {"sleepTimeSeconds": 1}}, day="2026-09-18")
        assert row["day"] == "2026-09-18"

    def test_no_date_anywhere_returns_none(self):
        assert N.normalize_sleep({"dailySleepDTO": {"sleepTimeSeconds": 1}}) is None

    def test_junk_payload(self):
        assert N.normalize_sleep({"dailySleepDTO": "nonsense"}, "2026-09-18") is None


class TestNormalizeDailySummary:
    def test_full_payload(self):
        row = N.normalize_daily_summary(F.DAILY_SUMMARY)
        assert row["day"] == "2026-09-20"
        assert row["resting_hr"] == 51
        assert row["steps"] == 14208
        assert row["stress_avg"] == 28
        assert row["bb_high"] == 88 and row["bb_low"] == 24
        assert row["intensity_minutes_vig"] == 41

    def test_floors_are_rounded_to_an_int(self):
        assert N.normalize_daily_summary(F.DAILY_SUMMARY)["floors"] == 12

    def test_missing_date(self):
        assert N.normalize_daily_summary({"totalSteps": 1}) is None


class TestNormalizeHrv:
    def test_full_payload(self):
        row = N.normalize_hrv(F.HRV)
        assert row["day"] == "2026-09-20"
        assert row["last_night_avg"] == 61
        assert row["last_night_5min_high"] == 78
        assert row["weekly_avg"] == 59
        assert row["baseline_low"] == 52
        assert row["baseline_high"] == 68
        assert row["status"] == "BALANCED"

    def test_falls_back_to_the_weekly_average(self):
        row = N.normalize_hrv({"hrvSummary": {"calendarDate": "2026-09-20", "weeklyAvg": 55}})
        assert row["last_night_avg"] == 55

    def test_missing_summary(self):
        assert N.normalize_hrv({"hrvSummary": None}) is None


class TestNormalizeFitness:
    def test_training_readiness_unwraps_the_list(self):
        row = N.normalize_training_readiness(F.TRAINING_READINESS)
        assert row == {"day": "2026-09-20", "training_readiness": 74}

    def test_training_readiness_empty_list(self):
        assert N.normalize_training_readiness([]) is None

    def test_training_status_digs_through_the_device_map(self):
        row = N.normalize_training_status(F.TRAINING_STATUS)
        assert row["day"] == "2026-09-20"
        assert row["vo2max_run"] == pytest.approx(52.3)   # precise value preferred
        assert row["vo2max_cycle"] == pytest.approx(48.2)
        assert row["training_status"] == "PRODUCTIVE_1"
        assert row["acute_load"] == pytest.approx(1.12)

    def test_training_status_without_vo2max(self):
        row = N.normalize_training_status({"calendarDate": "2026-09-20"})
        assert row["vo2max_run"] is None and row["training_status"] is None

    def test_training_status_junk(self):
        assert N.normalize_training_status("not a mapping") is None


class TestNormalizeWeight:
    def test_grams_become_kilograms(self):
        rows = N.normalize_weight(F.WEIGHT)
        assert len(rows) == 2
        assert rows[0]["day"] == "2026-09-20"
        assert rows[0]["weight_kg"] == pytest.approx(74.35)
        assert rows[0]["body_fat_pct"] == pytest.approx(16.4)
        assert rows[1]["weight_kg"] == pytest.approx(74.8)

    def test_missing_wrapper(self):
        assert N.normalize_weight({}) == []

    def test_entry_without_metrics_is_skipped(self):
        assert N.normalize_weight({"dailyWeightSummaries": [{"summaryDate": "2026-09-20"}]}) == []


class TestMergeDaily:
    def test_later_values_win_but_none_never_overwrites(self):
        """A training-status call that omits VO2max must not blank one already found."""
        merged = N.merge_daily([
            {"day": "2026-09-20", "vo2max_run": 52.3, "training_readiness": None},
            {"day": "2026-09-20", "training_readiness": 74, "vo2max_run": None},
        ])
        assert merged["2026-09-20"] == {"day": "2026-09-20", "vo2max_run": 52.3,
                                        "training_readiness": 74}

    def test_rows_without_a_day_are_dropped(self):
        assert N.merge_daily([{"vo2max_run": 50}, None, {}]) == {}


# ---------------------------------------------------------------------------
# Sync loop, driven through an injected fetcher (no network, no credentials)
# ---------------------------------------------------------------------------


def fake_fetcher(responses: dict):
    """Return a fetcher that serves canned responses keyed by a path substring."""
    calls: list[str] = []

    def fetch(path: str):
        calls.append(path)
        for needle, payload in responses.items():
            if needle in path:
                return payload
        return None

    fetch.calls = calls
    return fetch


class TestSyncDailyEndpoint:
    def test_archives_raw_and_writes_normalised_rows(self, store):
        fetcher = fake_fetcher({"dailySleepData": F.SLEEP})
        result = connect.sync_daily_endpoint(
            store, "user", connect.ENDPOINTS["sleep"],
            dt.date(2026, 9, 20), dt.date(2026, 9, 20), fetcher=fetcher,
        )
        assert result["fetched"] == 1 and result["written"] == 1
        assert store.scalar("SELECT COUNT(*) FROM raw_documents WHERE endpoint='sleep'") == 1
        assert store.query("SELECT * FROM sleep")[0]["sleep_score"] == 78

    def test_normalised_row_points_at_its_raw_document(self, store):
        fetcher = fake_fetcher({"dailySleepData": F.SLEEP})
        connect.sync_daily_endpoint(store, "user", connect.ENDPOINTS["sleep"],
                                    dt.date(2026, 9, 20), dt.date(2026, 9, 20), fetcher=fetcher)
        row = store.query("SELECT raw_id FROM sleep")[0]
        raw = store.query("SELECT * FROM raw_documents WHERE id = ?", (row["raw_id"],))
        assert raw and raw[0]["endpoint"] == "sleep"

    def test_a_missing_day_is_skipped_not_fatal(self, store):
        """404 / no data is routine — the watch was off the wrist."""
        result = connect.sync_daily_endpoint(
            store, "user", connect.ENDPOINTS["sleep"],
            dt.date(2026, 9, 18), dt.date(2026, 9, 20), fetcher=fake_fetcher({}),
        )
        assert result["fetched"] == 0 and result["written"] == 0

    def test_rerunning_an_overlapping_range_does_not_duplicate(self, store):
        """Five days requested, each archived under its own ref_key.

        The canned payload carries calendarDate 2026-09-20, so only one `sleep` row
        exists no matter how many days were asked for; the archive keeps one document
        per (day, content hash). Re-running must change neither count.
        """
        fetcher = fake_fetcher({"dailySleepData": F.SLEEP})
        connect.sync_daily_endpoint(store, "user", connect.ENDPOINTS["sleep"],
                                    dt.date(2026, 9, 18), dt.date(2026, 9, 22), fetcher=fetcher)
        assert store.scalar("SELECT COUNT(*) FROM sleep") == 1
        assert store.scalar("SELECT COUNT(*) FROM raw_documents") == 5

        for _ in range(3):
            connect.sync_daily_endpoint(store, "user", connect.ENDPOINTS["sleep"],
                                        dt.date(2026, 9, 18), dt.date(2026, 9, 22),
                                        fetcher=fetcher)
        assert store.scalar("SELECT COUNT(*) FROM sleep") == 1
        assert store.scalar("SELECT COUNT(*) FROM raw_documents") == 5

    def test_watermark_advances(self, store):
        fetcher = fake_fetcher({"dailySleepData": F.SLEEP})
        connect.sync_daily_endpoint(store, "user", connect.ENDPOINTS["sleep"],
                                    dt.date(2026, 9, 20), dt.date(2026, 9, 21), fetcher=fetcher)
        assert store.get_watermark("sleep") == "2026-09-21"

    def test_the_user_and_date_are_substituted_into_the_path(self, store):
        fetcher = fake_fetcher({})
        connect.sync_daily_endpoint(store, "testathlete", connect.ENDPOINTS["sleep"],
                                    dt.date(2026, 9, 20), dt.date(2026, 9, 20), fetcher=fetcher)
        assert "testathlete" in fetcher.calls[0] and "2026-09-20" in fetcher.calls[0]

    def test_two_fitness_endpoints_merge_rather_than_clobber(self, store):
        """training_readiness and training_status both write `fitness`."""
        connect.sync_daily_endpoint(
            store, "u", connect.ENDPOINTS["training_readiness"],
            dt.date(2026, 9, 20), dt.date(2026, 9, 20),
            fetcher=fake_fetcher({"trainingreadiness": F.TRAINING_READINESS}),
        )
        connect.sync_daily_endpoint(
            store, "u", connect.ENDPOINTS["training_status"],
            dt.date(2026, 9, 20), dt.date(2026, 9, 20),
            fetcher=fake_fetcher({"trainingstatus": F.TRAINING_STATUS}),
        )
        row = store.query("SELECT * FROM fitness WHERE day = '2026-09-20'")[0]
        assert row["training_readiness"] == 74
        assert row["vo2max_run"] == pytest.approx(52.3)

    def test_weight_endpoint_writes_multiple_days_from_one_payload(self, store):
        connect.sync_daily_endpoint(
            store, "u", connect.ENDPOINTS["body"],
            dt.date(2026, 9, 20), dt.date(2026, 9, 20),
            fetcher=fake_fetcher({"weight-service": F.WEIGHT}),
        )
        assert store.scalar("SELECT COUNT(*) FROM body_composition") == 2


class TestSyncActivities:
    def test_writes_activity_zones_and_trimp(self, store):
        fetcher = fake_fetcher({
            "activities/search": [F.ACTIVITY],
            "hrTimeInZones": F.HR_ZONES,
        })
        result = connect.sync_activities(store, dt.date(2026, 9, 1), dt.date(2026, 9, 30),
                                         fetcher=fetcher)
        assert result["written"] == 1
        row = store.query("SELECT * FROM activities")[0]
        assert row["activity_id"] == "987654321"
        assert row["trimp"] > 0
        assert store.scalar("SELECT COUNT(*) FROM activity_hr_zones") == 5

    def test_trimp_uses_the_zones_when_they_exist(self, store):
        from garmin_analytics.analytics import load as L

        fetcher = fake_fetcher({"activities/search": [F.ACTIVITY], "hrTimeInZones": F.HR_ZONES})
        connect.sync_activities(store, dt.date(2026, 9, 1), dt.date(2026, 9, 30), fetcher=fetcher)
        expected = L.trimp_from_zones(N.normalize_hr_zones(F.HR_ZONES),
                                      store.settings.hr_rest, store.settings.hr_max,
                                      store.settings.sex)
        assert store.query("SELECT trimp FROM activities")[0]["trimp"] == pytest.approx(expected)

    def test_trimp_falls_back_to_average_hr_without_zones(self, store):
        from garmin_analytics.analytics import load as L

        fetcher = fake_fetcher({"activities/search": [F.ACTIVITY]})
        connect.sync_activities(store, dt.date(2026, 9, 1), dt.date(2026, 9, 30), fetcher=fetcher)
        expected = L.trimp(3688.0 / 60, 152.0, store.settings.hr_rest,
                           store.settings.hr_max, store.settings.sex)
        assert store.query("SELECT trimp FROM activities")[0]["trimp"] == pytest.approx(expected)

    def test_activities_outside_the_range_are_ignored(self, store):
        fetcher = fake_fetcher({"activities/search": [F.ACTIVITY]})
        connect.sync_activities(store, dt.date(2025, 1, 1), dt.date(2025, 12, 31),
                                fetcher=fetcher)
        assert store.scalar("SELECT COUNT(*) FROM activities") == 0

    def test_rerun_is_idempotent(self, store):
        fetcher = fake_fetcher({"activities/search": [F.ACTIVITY], "hrTimeInZones": F.HR_ZONES})
        for _ in range(3):
            connect.sync_activities(store, dt.date(2026, 9, 1), dt.date(2026, 9, 30),
                                    fetcher=fetcher)
        assert store.scalar("SELECT COUNT(*) FROM activities") == 1
        assert store.scalar("SELECT COUNT(*) FROM activity_hr_zones") == 5

    def test_the_activity_list_wrapper_shape_is_handled(self, store):
        fetcher = fake_fetcher({"activities/search": {"activityList": [F.ACTIVITY]}})
        connect.sync_activities(store, dt.date(2026, 9, 1), dt.date(2026, 9, 30), fetcher=fetcher)
        assert store.scalar("SELECT COUNT(*) FROM activities") == 1

    def test_zone_fetching_can_be_switched_off(self, store):
        fetcher = fake_fetcher({"activities/search": [F.ACTIVITY], "hrTimeInZones": F.HR_ZONES})
        connect.sync_activities(store, dt.date(2026, 9, 1), dt.date(2026, 9, 30),
                                fetcher=fetcher, with_zones=False)
        assert store.scalar("SELECT COUNT(*) FROM activity_hr_zones") == 0
        assert not any("hrTimeInZones" in c for c in fetcher.calls)


class TestDefaultStart:
    def test_uses_the_lookback_when_there_is_no_watermark(self, store):
        start = connect.default_start(store, "sleep", 30, dt.date(2026, 9, 30))
        assert start == dt.date(2026, 8, 31)

    def test_resumes_from_the_watermark_with_overlap(self, store):
        """Garmin backfills sleep and HRV for a day or two; the overlap is deliberate."""
        store.set_watermark("sleep", "2026-09-20")
        start = connect.default_start(store, "sleep", 400, dt.date(2026, 9, 30), overlap_days=3)
        assert start == dt.date(2026, 9, 17)


class TestRenormalize:
    def test_reparses_from_the_archive_without_any_network(self, store):
        connect.sync_daily_endpoint(store, "u", connect.ENDPOINTS["sleep"],
                                    dt.date(2026, 9, 20), dt.date(2026, 9, 20),
                                    fetcher=fake_fetcher({"dailySleepData": F.SLEEP}))
        store.conn.execute("DELETE FROM sleep")
        store.conn.commit()
        assert store.scalar("SELECT COUNT(*) FROM sleep") == 0

        counts = connect.renormalize(store)     # note: no fetcher at all
        assert counts["sleep"] == 1
        assert store.query("SELECT * FROM sleep")[0]["sleep_score"] == 78


class TestAuthHelpers:
    def test_missing_token_dir_is_reported_clearly(self, settings):
        with pytest.raises(connect.NotAuthenticated) as exc:
            connect.resume(settings.token_dir)
        assert "login" in str(exc.value)

    def test_token_dir_detection(self, settings, tmp_path):
        d = tmp_path / "tokens"
        assert not connect.token_dir_is_populated(d)
        d.mkdir()
        assert not connect.token_dir_is_populated(d)
        (d / connect.TOKEN_FILENAME).write_text("{}")
        assert connect.token_dir_is_populated(d)

    def test_a_leftover_garth_cache_does_not_read_as_connected(self, tmp_path):
        """Those files are a different token format. Treating them as a session
        would put the failure at the first sync instead of at the setup screen."""
        d = tmp_path / "tokens"
        d.mkdir()
        (d / "oauth1_token.json").write_text("{}")
        (d / "oauth2_token.json").write_text("{}")
        assert not connect.token_dir_is_populated(d)

    def test_secure_token_dir_tightens_permissions(self, tmp_path):
        d = tmp_path / "tokens"
        d.mkdir(mode=0o755)
        f = d / connect.TOKEN_FILENAME
        f.write_text("{}")
        f.chmod(0o644)
        connect.secure_token_dir(d)
        assert oct(d.stat().st_mode & 0o777) == "0o700"
        assert oct(f.stat().st_mode & 0o777) == "0o600"


# ---------------------------------------------------------------------------
# FIT — end-to-end through the real fitdecode
# ---------------------------------------------------------------------------


@pytest.fixture
def fit_path(tmp_path):
    start = dt.datetime(2026, 9, 20, 6, 0, 0, tzinfo=dt.timezone.utc)
    return fitgen.write_fit(tmp_path / "run.fit", start, fitgen.steady_run(start))


class TestFitParsing:
    def test_reads_a_real_fit_binary(self, fit_path):
        parsed = fitfile.read_fit(fit_path)
        assert len(parsed["records"]) == 241        # 0..2400 s inclusive, every 10 s
        assert parsed["session"]["sport"] == "running"

    def test_scaled_fields_come_back_in_si_units(self, fit_path):
        """FIT stores distance ×100, speed ×1000 and altitude ×5 with a 500 offset."""
        parsed = fitfile.read_fit(fit_path)
        last = parsed["records"][-1]
        assert last["distance_m"] == pytest.approx(7200.0)      # 3 m/s × 2400 s
        assert last["speed_mps"] == pytest.approx(3.0)
        assert last["altitude_m"] == pytest.approx(10.0)

    def test_to_activity_is_exact(self, fit_path):
        row = fitfile.to_activity(fitfile.read_fit(fit_path), "fit-run", tz_offset_hours=3.0)
        assert row["activity_type"] == "running"
        assert row["distance_m"] == pytest.approx(7200.0)
        assert row["moving_time_s"] == pytest.approx(2400.0)
        assert row["avg_hr"] == pytest.approx(154.0)            # (150+158)/2
        assert row["max_hr"] == 158.0
        assert row["avg_speed_mps"] == pytest.approx(3.0)
        assert row["start_time_utc"] == "2026-09-20T06:00:00Z"
        assert row["start_time_local"] == "2026-09-20T09:00:00"  # +3 h, Asia/Qatar

    def test_downsampling_keeps_the_endpoints(self, fit_path):
        samples = fitfile.to_samples(fitfile.read_fit(fit_path), "fit-run", interval_s=60)
        assert samples[0]["elapsed_s"] == 0.0
        assert samples[-1]["elapsed_s"] == 2400.0
        assert samples[-1]["distance_m"] == pytest.approx(7200.0)
        assert len(samples) == 41                                 # 0..2400 every 60 s

    def test_downsampling_at_the_native_rate_is_a_no_op(self, fit_path):
        samples = fitfile.to_samples(fitfile.read_fit(fit_path), "fit-run", interval_s=10)
        assert len(samples) == 241

    def test_hr_zones_from_the_stream(self, fit_path):
        zones = fitfile.hr_zone_seconds(fitfile.read_fit(fit_path), 50, 190)
        # HRr 150 → (150-50)/140 = 0.714 → zone 3;  158 → 0.771 → zone 3
        assert set(zones) == {3}
        assert sum(zones.values()) == pytest.approx(2400.0)

    def test_hr_zones_split_across_two_zones(self, tmp_path):
        start = dt.datetime(2026, 9, 20, 6, 0, 0, tzinfo=dt.timezone.utc)
        path = fitgen.write_fit(
            tmp_path / "split.fit", start,
            fitgen.steady_run(start, hr_first_half=120, hr_second_half=175),
        )
        zones = fitfile.hr_zone_seconds(fitfile.read_fit(path), 50, 190)
        assert len(zones) >= 2
        assert sum(zones.values()) == pytest.approx(2400.0)

    def test_decoupling_of_a_parsed_fit_matches_the_pure_function(self, fit_path):
        from garmin_analytics.analytics import performance as P

        parsed = fitfile.read_fit(fit_path)
        recs = parsed["records"]
        t0 = recs[0]["timestamp"]
        dec = P.aerobic_decoupling(
            [r["timestamp"] - t0 for r in recs],
            [r["distance_m"] for r in recs],
            [r["hr"] for r in recs],
        )
        # Pace held, HR rose 150 → 158 at halfway, so decoupling is positive but modest.
        assert 0 < dec < 10

    def test_parse_frames_ignores_unknown_message_types(self):
        class Frame:
            name = "device_info"

            def has_field(self, n):
                return False

            def get_value(self, n, fallback=None):
                return fallback

        out = fitfile.parse_frames([Frame()])
        assert out["records"] == [] and out["session"] == {}

    def test_to_activity_on_an_empty_parse(self):
        assert fitfile.to_activity({"records": [], "session": {}}, "x") is None


class TestFitImport:
    def test_import_writes_everything(self, store, fit_path):
        result = fitfile.import_fit_file(store, fit_path, tz_offset_hours=3.0)
        assert result["imported"] is True
        assert store.scalar("SELECT COUNT(*) FROM activities") == 1
        assert store.scalar("SELECT COUNT(*) FROM activity_samples") == result["samples"]
        assert store.scalar("SELECT COUNT(*) FROM activity_hr_zones") >= 1
        # 7.2 km of stream: 1 k, 1 mile and 5 k bests all exist
        assert store.scalar("SELECT COUNT(*) FROM best_efforts") >= 3

    def test_best_effort_from_the_fit_stream_is_exact(self, store, fit_path):
        """Constant 3 m/s: the fastest 1 000 m is 1000/3 = 333.33… s."""
        fitfile.import_fit_file(store, fit_path)
        secs = store.scalar(
            "SELECT seconds FROM best_efforts WHERE distance_m = 1000"
        )
        assert secs == pytest.approx(1000.0 / 3.0, abs=0.5)

    def test_reimport_is_idempotent(self, store, fit_path):
        first = fitfile.import_fit_file(store, fit_path)
        fitfile.import_fit_file(store, fit_path)
        assert store.scalar("SELECT COUNT(*) FROM activities") == 1
        assert store.scalar("SELECT COUNT(*) FROM activity_samples") == first["samples"]

    def test_the_parsed_structure_is_archived(self, store, fit_path):
        fitfile.import_fit_file(store, fit_path)
        raw = store.query("SELECT * FROM raw_documents WHERE source = 'fitfile'")
        assert len(raw) == 1
        assert json.loads(raw[0]["payload"])["n_records"] == 241


# ---------------------------------------------------------------------------
# Export ZIP
# ---------------------------------------------------------------------------


@pytest.fixture
def export_zip_path(tmp_path):
    """A stand-in for Garmin's GDPR export, with its real directory layout."""
    path = tmp_path / "garmin_export.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("DI_CONNECT/DI-Connect-Fitness/user_0_summarizedActivities.json",
                    json.dumps([{"summarizedActivitiesExport": [F.EXPORT_ACTIVITY]}]))
        zf.writestr("DI_CONNECT/DI-Connect-Wellness/user_2026-09-16_2026-09-17_sleepData.json",
                    json.dumps(F.EXPORT_SLEEP))
        zf.writestr("DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026-09-17_2026-09-17.json",
                    json.dumps(F.EXPORT_WELLNESS))
        zf.writestr("DI_CONNECT/DI-Connect-Wellness/user_weightData.json",
                    json.dumps(F.WEIGHT))
        zf.writestr("DI_CONNECT/DI-Connect-Future/whatever.json",
                    json.dumps(F.EXPORT_UNKNOWN))
        zf.writestr("DI_CONNECT/README.txt", "not json")
        zf.writestr("DI_CONNECT/broken.json", "{ this is not valid json")
    return path


class TestExportZip:
    def test_imports_each_recognised_shape(self, store, export_zip_path):
        result = export_zip.import_zip(store, export_zip_path)
        assert result["written"]["activities"] == 1
        assert result["written"]["sleep"] == 2
        assert result["written"]["wellness"] == 1
        assert result["written"]["body"] == 2

    def test_export_units_are_converted(self, store, export_zip_path):
        export_zip.import_zip(store, export_zip_path)
        row = store.query("SELECT * FROM activities")[0]
        assert row["distance_m"] == pytest.approx(12043.28)   # from 1 204 328 cm
        assert row["duration_s"] == pytest.approx(3721.5)     # from 3 721 500 ms
        assert row["avg_speed_mps"] == pytest.approx(3.266)   # from 3266 mm/s
        assert row["elevation_gain_m"] == pytest.approx(41.0)
        assert row["activity_type"] == "running"

    def test_unrecognised_documents_are_archived_not_discarded(self, store, export_zip_path):
        result = export_zip.import_zip(store, export_zip_path)
        assert result["unrecognised_count"] >= 1
        archived = store.query(
            "SELECT ref_key FROM raw_documents WHERE source = 'export_zip'"
        )
        names = {r["ref_key"] for r in archived}
        assert any("whatever.json" in n for n in names)

    def test_invalid_json_members_are_reported_not_silently_lost(self, store, export_zip_path):
        """6 .json members; broken.json fails to decode, so 5 are scanned and 1 reported.

        README.txt is not JSON and is not counted at all.
        """
        result = export_zip.import_zip(store, export_zip_path)
        assert result["members_scanned"] == 5
        assert result["undecodable_count"] == 1
        assert "broken.json" in result["undecodable"][0]

    def test_reimport_is_idempotent(self, store, export_zip_path):
        export_zip.import_zip(store, export_zip_path)
        counts = store.table_counts()
        export_zip.import_zip(store, export_zip_path)
        assert store.table_counts() == counts

    def test_missing_file_raises(self, store, tmp_path):
        with pytest.raises(FileNotFoundError):
            export_zip.import_zip(store, tmp_path / "nope.zip")

    def test_shape_detection(self):
        assert export_zip.detect_shape([F.EXPORT_ACTIVITY])[0] == "activities"
        assert export_zip.detect_shape(F.EXPORT_SLEEP)[0] == "sleep"
        assert export_zip.detect_shape(F.EXPORT_WELLNESS)[0] == "wellness"
        assert export_zip.detect_shape([{"nothing": "known"}]) is None

    def test_records_of_unwraps_known_containers(self):
        assert export_zip.records_of({"summarizedActivitiesExport": [{"a": 1}]}) == [{"a": 1}]
        assert export_zip.records_of([{"a": 1}]) == [{"a": 1}]
        assert export_zip.records_of("string") == []
