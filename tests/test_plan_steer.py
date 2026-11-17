"""The plan's steering answer: how far it was followed and what puts the race at risk."""

from __future__ import annotations

from datetime import date

from odeda.analytics import plan as plan_mod
from odeda.analytics import steer

TODAY = date(2026, 11, 15)  # a Sunday; the week is Mon 9 Nov to Sun 15 Nov


def judged(day: str, verdict: str, kind: str = "easy", sport: str = "running") -> plan_mod.Judged:
    planned = plan_mod.PlannedDay(
        day=day, sport=sport, kind=kind, min_m=8000.0, max_m=8000.0, optional=False, title="x"
    )
    return plan_mod.Judged(planned=planned, verdict=verdict)


class TestStanding:
    def test_names_the_share_of_the_plans_kilometres_run(self):
        assert steer.standing(110) == "ahead"
        assert steer.standing(100) == "on_track"
        assert steer.standing(85) == "on_track"
        assert steer.standing(60) == "behind"
        assert steer.standing(20) == "well_behind"

    def test_is_unknown_with_nothing_planned_to_judge_against(self):
        assert steer.standing(None) == "unknown"


class TestKeySession:
    def test_is_this_weeks_long_run_whatever_became_of_it(self):
        items = [judged("2026-11-13", "missed", "long"), judged("2026-11-20", "upcoming", "long")]
        assert steer.key_session(items, TODAY)["day"] == "2026-11-13"

    def test_is_the_next_long_run_when_this_week_has_none(self):
        items = [judged("2026-11-09", "done", "easy"), judged("2026-11-20", "upcoming", "long")]
        assert steer.key_session(items, TODAY)["day"] == "2026-11-20"

    def test_is_none_without_a_long_run_ahead(self):
        assert steer.key_session([judged("2026-11-09", "done", "easy")], TODAY) is None


class TestRisks:
    def test_low_volume_comes_first(self):
        found = steer.risks([judged("2026-11-13", "missed", "long")], TODAY, 20.0)
        assert [r["code"] for r in found] == ["volume_low", "long_run_cut"]

    def test_a_cut_short_long_run_is_a_risk_for_two_weeks(self):
        found = steer.risks([judged("2026-11-06", "short", "long")], TODAY, 90.0)
        assert [r["code"] for r in found] == ["long_run_cut"]
        assert steer.risks([judged("2026-10-20", "short", "long")], TODAY, 90.0) == []

    def test_three_missed_runs_in_a_week_is_a_streak_but_two_is_not(self):
        two = [judged("2026-11-10", "missed"), judged("2026-11-12", "missed")]
        three = two + [judged("2026-11-14", "missed")]
        assert steer.risks(two, TODAY, 90.0) == []
        assert [r["code"] for r in steer.risks(three, TODAY, 90.0)] == ["missed_streak"]

    def test_shows_at_most_two_and_the_worst_two(self):
        items = [judged("2026-11-13", "missed", "long")] + [
            judged(f"2026-11-{d}", "missed") for d in (10, 11, 12)
        ]
        found = steer.risks(items, TODAY, 20.0)
        assert [r["code"] for r in found] == ["volume_low", "long_run_cut"]

    def test_nothing_at_risk_is_an_empty_list(self):
        assert steer.risks([judged("2026-11-10", "done")], TODAY, 100.0) == []

    def test_optional_and_ignored_sessions_are_never_a_risk(self):
        item = judged("2026-11-13", "missed", "long")
        item.planned.optional = True
        assert steer.risks([item], TODAY, 90.0) == []
