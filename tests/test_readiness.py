"""Readiness composite and the race panel."""

from __future__ import annotations

from datetime import date

import pytest

from garmin_analytics import config
from garmin_analytics.analytics import readiness as R


class TestComponents:
    def test_sleep_score_is_used_verbatim_when_present(self):
        score, why = R.sleep_component(84, 7 * 3600)
        assert score == 84
        assert "84" in why and "good" in why

    def test_falls_back_to_hours_when_no_score(self):
        """8 h maps to 100, 4 h to 0, linear between: 6 h → 50."""
        score, why = R.sleep_component(None, 6 * 3600)
        assert score == pytest.approx(50.0)
        assert "no sleep score" in why

    def test_hours_fallback_is_clamped(self):
        assert R.sleep_component(None, 12 * 3600)[0] == 100.0
        assert R.sleep_component(None, 1 * 3600)[0] == 0.0

    def test_no_sleep_data_at_all(self):
        score, why = R.sleep_component(None, None)
        assert score is None and why == "No sleep data."

    def test_z_component_maps_zero_to_fifty(self):
        assert R.z_component(0.0, +1, "HRV")[0] == pytest.approx(50.0)

    def test_z_component_saturates_at_two_sigma(self):
        assert R.z_component(2.0, +1, "HRV")[0] == 100.0
        assert R.z_component(-2.0, +1, "HRV")[0] == 0.0
        assert R.z_component(5.0, +1, "HRV")[0] == 100.0

    def test_z_component_direction_flips_the_meaning(self):
        """The same +1σ is good for HRV and bad for resting HR."""
        assert R.z_component(1.0, +1, "HRV")[0] > 50
        assert R.z_component(1.0, -1, "Resting HR")[0] < 50

    def test_z_component_wording(self):
        assert "well above" in R.z_component(2.0, +1, "HRV")[1]
        assert "well below" in R.z_component(-2.0, +1, "HRV")[1]
        assert " at baseline" in R.z_component(0.1, +1, "HRV")[1]

    def test_tsb_component_hand_checked(self):
        """−30 → 0, +10 → 100, linear: TSB −10 → (−10+30)/40×100 = 50."""
        assert R.tsb_component(-10.0)[0] == pytest.approx(50.0)
        assert R.tsb_component(-30.0)[0] == pytest.approx(0.0)
        assert R.tsb_component(10.0)[0] == pytest.approx(100.0)
        assert R.tsb_component(40.0)[0] == 100.0

    def test_tsb_component_explains_itself(self):
        assert "fatigued" in R.tsb_component(-20.0)[1]


class TestComposite:
    def test_all_components_present(self):
        """0.30×80 + 0.25×60 + 0.25×40 + 0.20×20 = 24 + 15 + 10 + 4 = 53."""
        assert R.composite({"sleep": 80, "hrv": 60, "tsb": 40, "rhr": 20}) == pytest.approx(53.0)

    def test_missing_component_renormalises_rather_than_scoring_zero(self):
        """Dropping HRV must not drag the score down as if HRV were zero.

        weights left: 0.30 + 0.25 + 0.20 = 0.75
        (0.30×80 + 0.25×40 + 0.20×20) / 0.75 = (24 + 10 + 4) / 0.75 = 50.666…
        """
        out = R.composite({"sleep": 80, "hrv": None, "tsb": 40, "rhr": 20})
        assert out == pytest.approx(38.0 / 0.75, abs=1e-9)
        assert out > R.composite({"sleep": 80, "hrv": 0, "tsb": 40, "rhr": 20})

    def test_single_component_is_that_component(self):
        assert R.composite({"sleep": 70, "hrv": None, "tsb": None, "rhr": None}) == 70

    def test_nothing_usable_is_none(self):
        assert R.composite({"sleep": None, "hrv": None, "tsb": None, "rhr": None}) is None

    def test_unknown_keys_are_ignored(self):
        assert R.composite({"sleep": 70, "made_up": 0}) == 70

    def test_weights_sum_to_one(self):
        assert sum(R.WEIGHTS.values()) == pytest.approx(1.0)


class TestBandsAndAdvice:
    @pytest.mark.parametrize("score, band", [(95, "prime"), (70, "ready"), (55, "moderate"),
                                             (40, "low"), (20, "rest")])
    def test_bands(self, score, band):
        assert R.readiness_band(score) == band

    def test_low_score_says_rest_and_names_the_culprit(self):
        advice = R.recommendation(20, -5, [{"metric": "hrv", "verdict": "worse than baseline"}])
        assert "Rest" in advice and "hrv" in advice

    def test_high_score_with_deep_fatigue_is_tempered(self):
        assert "deep in the hole" in R.recommendation(85, -25, [])

    def test_high_score_with_fresh_legs_is_a_green_light(self):
        assert "Green light" in R.recommendation(85, 5, [])


class TestComputeReadiness:
    def test_empty_store(self, store):
        out = R.compute_readiness(store)
        assert out["score"] is None and out["day"] is None

    def test_seeded_store(self, seeded_store):
        out = R.compute_readiness(seeded_store)
        assert 0 <= out["score"] <= 100
        assert out["band"] in {"prime", "ready", "moderate", "low", "rest"}
        assert len(out["reasons"]) == 4
        assert out["recommendation"]

    def test_score_matches_its_own_components(self, seeded_store):
        """The published score must be the weighted mean of the published components.

        Tolerance is 0.2 rather than exact: the components are rounded to one decimal
        before they leave the API, so recomputing from them accumulates ~0.05 of
        rounding per component.
        """
        out = R.compute_readiness(seeded_store)
        assert out["score"] == pytest.approx(R.composite(out["components"]), abs=0.2)

    def test_history_is_bounded_and_ordered(self, seeded_store):
        hist = R.readiness_history(seeded_store, days=30)
        assert 0 < len(hist) <= 30
        assert [h["day"] for h in hist] == sorted(h["day"] for h in hist)
        for h in hist:
            if h["score"] is not None:
                assert 0 <= h["score"] <= 100

    def test_history_last_day_agrees_with_the_point_calculation(self, seeded_store):
        """The batched history path and the single-day path must not disagree."""
        hist = R.readiness_history(seeded_store, days=5)
        point = R.compute_readiness(seeded_store)
        assert hist[-1]["day"] == point["day"]
        assert hist[-1]["score"] == pytest.approx(point["score"], abs=1.5)


#: The half, as a test fixture. It used to come from `config.RACE_DISTANCE_M`; the race
#: is the calendar's now (T57), and a unit test of Riegel should name its own target.
HALF_M = 21097.5


class TestRaceProjection:
    BESTS = [
        {"distance_m": 1000.0, "seconds": 240.0, "label": "1 k", "time": "4:00", "day": "2026-09-01"},
        {"distance_m": 5000.0, "seconds": 1320.0, "label": "5 k", "time": "22:00", "day": "2026-09-10"},
        {"distance_m": 10000.0, "seconds": 2760.0, "label": "10 k", "time": "46:00", "day": "2026-09-15"},
    ]

    def test_prefers_the_longest_qualifying_effort(self):
        """Projecting a half from a 1 k flatters badly; the 10 k must win."""
        out = R.project_race_time(self.BESTS, HALF_M)
        assert out["from_distance_m"] == 10000.0

    def test_projection_matches_riegel_from_that_effort(self):
        from garmin_analytics.analytics import performance as P

        out = R.project_race_time(self.BESTS, HALF_M)
        assert out["projected_seconds"] == pytest.approx(
            P.riegel(2760.0, 10000.0, HALF_M), abs=0.05
        )

    def test_rejects_efforts_longer_than_the_target(self):
        """A marathon best must not be used to project a half."""
        out = R.project_race_time(
            self.BESTS + [{"distance_m": 42195.0, "seconds": 12000.0, "label": "M",
                           "time": "3:20:00", "day": "2026-05-01"}],
            HALF_M,
        )
        assert out["from_distance_m"] == 21097.5 or out["from_distance_m"] == 10000.0
        assert out["from_distance_m"] < 42195.0

    def test_accepts_an_effort_at_the_race_distance(self):
        bests = self.BESTS + [
            {"distance_m": 21097.5, "seconds": 6000.0, "label": "HM", "time": "1:40:00",
             "day": "2026-07-11"}
        ]
        out = R.project_race_time(bests, HALF_M)
        assert out["from_distance_m"] == 21097.5
        assert out["projected_seconds"] == pytest.approx(6000.0, abs=0.1)

    def test_none_without_any_usable_effort(self):
        assert R.project_race_time([], HALF_M) is None
        assert R.project_race_time(
            [{"distance_m": 42195.0, "seconds": 12000.0, "label": "M"}], HALF_M
        ) is None

    def test_no_target_distance_is_no_projection(self):
        """A calendar race may name no distance; there is nothing to project to."""
        assert R.project_race_time(self.BESTS, None) is None

    def test_reports_its_own_source(self):
        out = R.project_race_time(self.BESTS, HALF_M)
        assert out["from_label"] == "10 k"
        assert out["from_day"] == "2026-09-15"
        assert out["exponent"] == 1.06


def add_race(store, day="2027-01-15", title="RACE: Ooredoo Doha Half Marathon",
             start="07:35", distance_m=21097.5):
    """A race in the calendar, which is where the race lives now (T57)."""
    store.conn.execute(
        "INSERT INTO plan_sources (kind, url, label, enabled) "
        "VALUES ('ics', 'https://example.test/x.ics', 'Test', 1)"
    )
    sid = store.conn.execute("SELECT id FROM plan_sources").fetchone()[0]
    store.conn.execute(
        "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, start_local, "
        "sport, kind, planned_min_m, planned_max_m, title, parse_status) "
        "VALUES (?, 'race-uid', '', ?, ?, 'running', 'race', ?, ?, ?, 'ok')",
        (sid, day, f"{day}T{start}:00", distance_m, distance_m, title),
    )
    store.conn.commit()


class TestRacePanel:
    def test_countdown_is_correct(self, store):
        add_race(store)
        out = R.compute_race(store, today=date(2026, 12, 1))
        assert out["days_to_go"] == 45
        assert out["race"]["name"] == "Ooredoo Doha Half Marathon"

    def test_no_race_ahead_is_a_null_countdown_not_a_negative_one(self, store):
        """What the constant got wrong: on 1 February it counted -17 days to a race
        run in January. `goal_race` only returns one still to come."""
        add_race(store)
        out = R.compute_race(store, today=date(2027, 2, 1))
        assert out["race"] is None
        assert out["days_to_go"] is None
        assert out["weeks_to_go"] is None
        assert any("No race in the calendar" in n["text"] for n in out["notes"])

    def test_an_empty_calendar_says_so_rather_than_inventing_a_race(self, seeded_store):
        out = R.compute_race(seeded_store, today=date(2026, 9, 22))
        assert out["race"] is None
        assert any("No race in the calendar" in n["text"] for n in out["notes"])

    def test_notes_carry_their_own_severity(self, seeded_store):
        out = R.compute_race(seeded_store, today=date(2026, 9, 22))
        for note in out["notes"]:
            assert note["level"] in {"good", "warning"}
            assert note["text"]

    def test_panel_shape(self, store):
        add_race(store)
        out = R.compute_race(store, today=date(2026, 9, 22))
        assert out["race"]["date"] == "2027-01-15"
        assert out["race"]["start_local"] == "07:35"
        assert out["race"]["distance_m"] == 21097.5
        assert isinstance(out["weekly_km"], list)

    def test_no_plan_means_no_target_rather_than_an_invented_one(self, seeded_store):
        """D12. A store with activities and no subscribed calendar is every install
        before the owner connects one, and it gets curves without a goal line."""
        out = R.compute_race(seeded_store, today=date(2026, 9, 22))
        assert out["ctl_target"] is None
        assert out["weekly_km_target"] is None
        assert out["ctl_per_week_needed"] is None
        assert out["targets"]["source"] == "none"
        assert any("no target" in n["text"] for n in out["notes"])

    def test_no_note_compares_volume_against_a_number_nobody_set(self, seeded_store):
        """The note this replaces read "28-day average N km/wk against a 55 km target
        peak — a long way short", on an athlete whose plan never asks for 55."""
        out = R.compute_race(seeded_store, today=date(2026, 9, 22))
        assert not any("target peak" in n["text"] for n in out["notes"])

    def test_trailing_weekly_km_ignores_the_partial_current_week(self, seeded_store):
        """Anchoring on calendar weeks would report a volume drop that is really a Tuesday."""
        trailing = R.trailing_weekly_km(seeded_store, 28)
        weeks = R.weekly_distance(seeded_store)
        last_four_calendar = sum(w["km"] for w in weeks[-4:]) / 4
        assert trailing > last_four_calendar

    def test_empty_store_does_not_crash(self, store):
        out = R.compute_race(store, today=date(2026, 9, 22))
        assert out["projection"] is None
        assert out["ctl_now"] == 0.0
