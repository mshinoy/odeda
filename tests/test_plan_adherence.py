"""Matching what was prescribed to what was done.

The rules under test came from the owner, not from the author, and each one exists
because the obvious implementation got it wrong in a way that would have made the app
argue with him about sessions he had actually done.
"""

from __future__ import annotations

from datetime import date

import pytest

from garmin_analytics.analytics import plan as A
from garmin_analytics.plan import parse as P

TODAY = date(2027, 1, 20)


def session(day, sport=P.SPORT_RUN, *, kind=None, lo=None, hi=None, title="",
            recurring=False, source="", optional=False, sid=None):
    return {
        "id": sid, "day": day, "sport": sport, "kind": kind,
        "planned_min_m": lo, "planned_max_m": hi if hi is not None else lo,
        "title": title, "recurring": recurring, "source": source, "optional": optional,
    }


def activity(day, kind="running", metres=None, seconds=3600, aid=None):
    return {
        "activity_id": aid or f"{day}-{kind}", "day": day, "activity_type": kind,
        "distance_m": metres, "duration_s": seconds,
    }


class TestOneDayOneSession:
    def test_two_events_describing_one_run_are_one_prescription(self):
        """The club entry says where and when; the Higdon entry says how far. The
        athlete was never going to do both."""
        days = A.collapse([
            session("2027-01-08", title="Long Run - DBRC", recurring=True, kind="long"),
            session("2027-01-08", title="W11: LONG RUN 16.1 km", lo=16100, kind="long"),
        ])
        assert len(days) == 1
        assert days[0].min_m == 16100

    def test_the_more_specific_event_wins_so_a_taper_stays_a_taper(self):
        """12 Jan: the club series says 8-10 km every week; the dated event says 3.2.
        Taking the larger would have him run 10 km in his taper week."""
        days = A.collapse([
            session("2027-01-12", lo=8000, hi=10000, title="Katara Hills - Run - DBRC",
                    recurring=True),
            session("2027-01-12", lo=3200, title="W12: Run 3.2 km"),
        ])
        assert len(days) == 1
        assert days[0].min_m == 3200

    def test_a_hint_beats_even_a_dated_event(self):
        days = A.collapse([
            session("2027-01-12", lo=3200, title="W12: Run 3.2 km"),
            session("2027-01-12", lo=5000, title="hinted", source="hint"),
        ])
        assert days[0].min_m == 5000

    def test_two_sports_on_one_day_stay_two_prescriptions(self):
        """Every Monday is an easy run and a gym session."""
        days = A.collapse([
            session("2026-12-07", P.SPORT_RUN, lo=7200),
            session("2026-12-07", P.SPORT_GYM, kind="gym"),
        ])
        assert {d.sport for d in days} == {P.SPORT_RUN, P.SPORT_GYM}


class TestRunningFurtherIsNotADeviation:
    def test_beating_the_target_is_done(self):
        days = A.collapse([session("2027-01-08", lo=16100, kind="long")])
        judged, _ = A.match(days, [activity("2027-01-08", metres=19000)], TODAY)
        assert judged[0].verdict == "done"
        assert judged[0].actual_m == 19000

    def test_there_is_no_verdict_for_going_long(self):
        assert "over" not in A.VERDICTS

    def test_falling_well_short_is_short(self):
        days = A.collapse([session("2027-01-08", lo=16100, kind="long")])
        judged, _ = A.match(days, [activity("2027-01-08", metres=9000)], TODAY)
        assert judged[0].verdict == "short"

    def test_a_hair_under_is_not_a_failure(self):
        """GPS alone moves a long run by tens of metres. 15.9 km against 16.1 is the
        session, not a miss."""
        days = A.collapse([session("2027-01-08", lo=16100, kind="long")])
        judged, _ = A.match(days, [activity("2027-01-08", metres=15900)], TODAY)
        assert judged[0].verdict == "done"

    def test_the_top_of_a_range_is_not_required(self):
        days = A.collapse([session("2026-12-08", lo=8000, hi=10000)])
        judged, _ = A.match(days, [activity("2026-12-08", metres=8200)], TODAY)
        assert judged[0].verdict == "done"


class TestSubstitution:
    def test_a_ride_on_a_run_day_is_one_substitution_not_two_failures(self):
        days = A.collapse([session("2026-12-11", P.SPORT_RUN, lo=18000, kind="long")])
        judged, unplanned = A.match(days, [activity("2026-12-11", "cycling", 42000)], TODAY)
        assert judged[0].verdict == "substituted"
        assert judged[0].actual_sport == P.SPORT_RIDE
        assert unplanned == []

    def test_a_substitution_is_not_silently_scored_as_success(self):
        days = A.collapse([session("2026-12-11", P.SPORT_RUN, lo=18000, kind="long")])
        judged, _ = A.match(days, [activity("2026-12-11", "cycling", 42000)], TODAY)
        assert not judged[0].credited
        assert judged[0].counts

    def test_a_gym_session_cannot_stand_in_for_a_long_run(self):
        """Lifting is not an endurance substitute, and a plan that accepted it would
        say the long run happened."""
        days = A.collapse([session("2026-12-11", P.SPORT_RUN, lo=18000, kind="long")])
        judged, unplanned = A.match(days, [activity("2026-12-11", "strength", None)], TODAY)
        assert judged[0].verdict == "missed"
        assert len(unplanned) == 1


class TestRestAndOptional:
    def test_resting_on_a_rest_day_counts(self):
        days = A.collapse([session("2027-01-10", P.SPORT_REST, kind="rest")])
        judged, _ = A.match(days, [], TODAY)
        assert judged[0].verdict == "rest-kept"
        assert judged[0].credited

    def test_running_on_a_rest_day_is_a_violation_not_a_bonus(self):
        days = A.collapse([session("2027-01-10", P.SPORT_REST, kind="rest")])
        judged, _ = A.match(days, [activity("2027-01-10", metres=10000)], TODAY)
        assert judged[0].verdict == "rest-broken"
        assert not judged[0].credited

    def test_a_skipped_optional_session_is_not_a_miss(self):
        """`W6: Easy spin (optional)`. Counting it against him makes the plan punish
        him for following it."""
        days = A.collapse([session("2026-12-05", P.SPORT_RIDE, optional=True, kind="cross")])
        judged, _ = A.match(days, [], TODAY)
        assert not judged[0].counts
        assert judged[0].planned.weight == 0.0

    def test_one_firm_event_on_a_day_makes_the_day_owed(self):
        days = A.collapse([
            session("2026-12-05", P.SPORT_RIDE, optional=True),
            session("2026-12-05", P.SPORT_RIDE, optional=False),
        ])
        assert days[0].optional is False


class TestMovedSessions:
    def test_a_session_done_a_day_late_still_counts(self):
        days = A.collapse([session("2026-12-11", lo=18000, kind="long")])
        judged, unplanned = A.match(days, [activity("2026-12-12", metres=18500)], TODAY)
        assert judged[0].verdict == "done"
        assert judged[0].moved_from == "2026-12-12"
        assert unplanned == []

    def test_it_does_not_steal_a_day_the_plan_already_spent(self):
        """Friday's long run must not be credited with Saturday's prescribed ride."""
        days = A.collapse([
            session("2026-12-11", P.SPORT_RUN, lo=18000, kind="long"),
            session("2026-12-12", P.SPORT_RIDE, kind="cross"),
        ])
        judged, _ = A.match(days, [activity("2026-12-12", "cycling", 40000)], TODAY)
        friday = next(j for j in judged if j.planned.day == "2026-12-11")
        saturday = next(j for j in judged if j.planned.day == "2026-12-12")
        assert friday.verdict == "missed"
        assert saturday.verdict == "done"

    def test_three_days_late_is_a_different_session(self):
        days = A.collapse([session("2026-12-11", lo=18000, kind="long")])
        judged, unplanned = A.match(days, [activity("2026-12-14", metres=18000)], TODAY)
        assert judged[0].verdict == "missed"
        assert len(unplanned) == 1


class TestOneActivityOneSession:
    def test_a_single_run_cannot_satisfy_two_days(self):
        days = A.collapse([
            session("2026-12-10", P.SPORT_RUN, lo=8000),
            session("2026-12-11", P.SPORT_RUN, lo=18000, kind="long"),
        ])
        judged, _ = A.match(days, [activity("2026-12-11", metres=18000)], TODAY)
        verdicts = {j.planned.day: j.verdict for j in judged}
        assert verdicts["2026-12-11"] == "done"
        assert verdicts["2026-12-10"] == "missed"

    def test_the_longest_effort_of_the_day_answers_the_prescription(self):
        """A 2 km warm-up logged separately should not be what Friday is credited with."""
        days = A.collapse([session("2026-12-11", lo=18000, kind="long")])
        judged, unplanned = A.match(
            days,
            [activity("2026-12-11", metres=2000, aid="warmup"),
             activity("2026-12-11", metres=18400, aid="long")],
            TODAY,
        )
        assert judged[0].activity_id == "long"
        assert [a["activity_id"] for a in unplanned] == ["warmup"]


class TestFuture:
    def test_a_day_still_to_come_is_not_a_miss(self):
        days = A.collapse([session("2027-01-22", lo=18000, kind="long")])
        judged, _ = A.match(days, [], today=date(2027, 1, 20))
        assert judged[0].verdict == "upcoming"
        assert not judged[0].counts

    def test_today_is_not_judged_until_it_is_over(self):
        days = A.collapse([session("2027-01-20", lo=18000, kind="long")])
        judged, _ = A.match(days, [], today=date(2027, 1, 20))
        assert judged[0].verdict == "upcoming"


class TestWeekly:
    def _week(self):
        days = A.collapse([
            session("2026-12-07", P.SPORT_RUN, lo=7200, kind="easy"),
            session("2026-12-08", P.SPORT_RUN, lo=8000, hi=10000, kind="easy"),
            session("2026-12-09", P.SPORT_RIDE, kind="cross"),
            session("2026-12-11", P.SPORT_RUN, lo=18000, kind="long"),
            session("2026-12-13", P.SPORT_REST, kind="rest"),
        ])
        acts = [
            activity("2026-12-07", metres=7300),
            activity("2026-12-08", metres=9000),
            activity("2026-12-09", "cycling", 30000),
            activity("2026-12-11", metres=18600),
        ]
        return A.match(days, acts, TODAY)

    def test_a_fully_followed_week_is_a_hundred_percent(self):
        judged, _ = self._week()
        weeks = A.weekly(judged)
        assert len(weeks) == 1
        assert weeks[0]["adherence_pct"] == 100.0
        assert weeks[0]["long_run"] == "done"

    def test_planned_and_actual_kilometres_are_both_reported(self):
        judged, _ = self._week()
        week = A.weekly(judged)[0]
        assert week["planned_km"] == pytest.approx(34.2, abs=0.1)
        assert week["actual_km"] == pytest.approx(34.9, abs=0.1)

    def test_missing_the_long_run_costs_more_than_missing_an_easy_one(self):
        """Weekly volume here is nearly flat while the long run climbs, so the long run
        is most of the stimulus. An unweighted percentage would hide losing it."""
        days = A.collapse([
            session("2026-12-07", P.SPORT_RUN, lo=7200, kind="easy"),
            session("2026-12-11", P.SPORT_RUN, lo=18000, kind="long"),
        ])
        lost_long, _ = A.match(days, [activity("2026-12-07", metres=7300)], TODAY)
        lost_easy, _ = A.match(days, [activity("2026-12-11", metres=18000)], TODAY)
        assert A.weekly(lost_long)[0]["adherence_pct"] < A.weekly(lost_easy)[0]["adherence_pct"]

    def test_a_week_of_only_optional_sessions_has_no_percentage(self):
        days = A.collapse([session("2026-12-05", P.SPORT_RIDE, optional=True, kind="cross")])
        judged, _ = A.match(days, [], TODAY)
        assert A.weekly(judged)[0]["adherence_pct"] is None

    def test_rolling_adherence_ignores_weeks_with_nothing_to_judge(self):
        weeks = [
            {"adherence_pct": 100.0}, {"adherence_pct": None},
            {"adherence_pct": 50.0}, {"adherence_pct": 80.0},
        ]
        assert A.rolling_adherence(weeks, window=4) == pytest.approx(76.7, abs=0.1)


class TestRestDayDoesNotStarveARealSession:
    def test_a_rest_prescription_settles_after_the_others(self):
        """Defensive: a rest day claims *any* activity on it, so if one were ever
        listed beside a real prescription it must not take that session's activity."""
        days = A.collapse([
            session("2026-12-13", P.SPORT_REST, kind="rest"),
            session("2026-12-13", P.SPORT_RUN, lo=8000, kind="easy"),
        ])
        judged, unplanned = A.match(days, [activity("2026-12-13", metres=8200)], TODAY)
        run = next(j for j in judged if j.planned.sport == P.SPORT_RUN)
        rest = next(j for j in judged if j.planned.sport == P.SPORT_REST)
        assert run.verdict == "done"
        assert rest.verdict == "rest-kept"
        assert unplanned == []
