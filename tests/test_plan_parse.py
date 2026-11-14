"""Reading the plan's prose.

**Every string in this file is real.** The titles, the week notes and the gym routine
below were copied out of the owner's calendar on 2026-10-08, not written to suit the
parser. A parser tested against its author's own examples proves only that the author is
consistent — this repository has already produced 1,150 green tests and three bugs that
only live data found.
"""

from __future__ import annotations

import pytest

from garmin_analytics.plan import parse as P

# --- Real text ------------------------------------------------------------------------

WEEK_7 = (
    "HIGDON NOVICE 1 - WEEK 7 of 12 || MON (today): 7.2 km easy. || TUE - DBRC Katara "
    "Hills: Higdon says 7.2 km; club does 8-10 km, that is fine. || FRI - DBRC long run: "
    "target 18 km  (Higdon prescribes 11.3 - lower than you already run). || WED Lusail "
    "ride + SAT Olympic ride = Higdon cross-training. SUN = rest."
)

WEEK_8_PEAK = (
    "HIGDON NOVICE 1 - WEEK 8 of 12 || MON (today): 7.2 km easy. || TUE - DBRC Katara "
    "Hills: Higdon says 7.2 km; club does 8-10 km, that is fine. || FRI - DBRC long run: "
    "target 19-20 km  <-- PEAK  (Higdon prescribes 12.9 - lower than you already run). || "
    "WED Lusail ride + SAT Olympic ride = Higdon cross-training. SUN = rest."
)

WEEK_12_RACE = (
    "HIGDON NOVICE 1 - WEEK 12 of 12 || MON (today): 6.4 km easy. || TUE - DBRC Katara "
    "Hills: Higdon says 6.4 km; club does 8-10 km, that is fine. || FRI - DBRC long run: "
    "target RACE DAY  (Higdon prescribes HALF MARATHON - lower than you already run). || "
    "WED Lusail ride + SAT Olympic ride = Higdon cross-training. SUN = rest."
)

BASE_PHASE = (
    "BASE PHASE (pre-plan) - week 1 of Higdon starts Mon 26 Oct. || MON: 5 km easy. || "
    "TUE - DBRC 8-10 km. || FRI - DBRC long run, build toward 16 km. || WED + SAT rides. "
    "SUN rest. || Goal is consistency, not speed."
)

LONG_RUN_STANDING_NOTE = (
    "THE key session. Higdon Novice 1 builds 6.4 km -> 16.1 km, but you have already run "
    "18 km, so targets are set higher: ~14-15 km (late Oct) rising to 19-20 km peak "
    "(18 Dec), a second 18-20 km on 1 Jan, then taper. This week's target is on Monday's "
    "event. Fuel before and after - do not run this one in a calorie deficit."
)

GYM_ROUTINE = (
    "GYM - 2x/week - Jeff Nippard minimalist plan (adapted)\n"
    "This series covers BOTH Monday and Thursday - find your day below.\n\n"
    "1.  Hack squat - 1x4-6 (RPE 9, one rep shy), rest ~3 min, then 1x8-10 back-off\n"
    "2a. High-incline Smith press (bench 45-60) - 2x10-12\n"
    "4.  DB step-up - 1x8-10 per leg @ RPE 7\n"
    "DROP SET   - hit failure, cut weight 30-40%, go to failure again\n"
)

MONDAY = 0
TUESDAY = 1
WEDNESDAY = 2
FRIDAY = 4
SATURDAY = 5
SUNDAY = 6


class TestWeekNote:
    def test_the_owners_target_wins_over_the_higdon_number_beside_it(self):
        """`target 18 km (Higdon prescribes 11.3 ...)` — both numbers, one intention."""
        note = P.parse_week_note(WEEK_7)
        assert note[FRIDAY].min_m == 18000
        assert note[FRIDAY].max_m == 18000

    def test_the_club_distance_wins_over_the_higdon_number_before_it(self):
        """`Higdon says 7.2 km; club does 8-10 km` — the club run is what happens."""
        note = P.parse_week_note(WEEK_7)
        assert (note[TUESDAY].min_m, note[TUESDAY].max_m) == (8000, 10000)

    def test_a_range_survives_as_a_range(self):
        note = P.parse_week_note(WEEK_8_PEAK)
        assert (note[FRIDAY].min_m, note[FRIDAY].max_m) == (19000, 20000)

    def test_one_segment_may_prescribe_two_days(self):
        """`WED Lusail ride + SAT Olympic ride = Higdon cross-training`."""
        note = P.parse_week_note(WEEK_7)
        assert note[WEDNESDAY].sport == P.SPORT_RIDE
        assert note[SATURDAY].sport == P.SPORT_RIDE

    def test_rest_is_a_prescription_not_an_absence(self):
        note = P.parse_week_note(WEEK_7)
        assert note[SUNDAY].sport == P.SPORT_REST
        assert note[SUNDAY].kind == "rest"

    def test_the_monday_segment_gives_mondays_own_distance(self):
        note = P.parse_week_note(WEEK_7)
        assert note[MONDAY].min_m == 7200

    def test_the_base_phase_note_reads_the_same_way(self):
        note = P.parse_week_note(BASE_PHASE)
        assert note[MONDAY].min_m == 5000
        assert (note[TUESDAY].min_m, note[TUESDAY].max_m) == (8000, 10000)
        assert note[FRIDAY].min_m == 16000  # "build toward 16 km"
        assert note[SUNDAY].sport == P.SPORT_REST

    def test_race_day_is_a_race_not_a_distance_to_hit(self):
        note = P.parse_week_note(WEEK_12_RACE)
        assert note[FRIDAY].kind == "race"

    def test_text_without_the_delimiter_is_not_a_week_note(self):
        assert P.parse_week_note(LONG_RUN_STANDING_NOTE) == {}


class TestEventText:
    @pytest.mark.parametrize(
        "title, sport, metres",
        [
            ("Easy run 5 km", P.SPORT_RUN, 5000),
            ("Easy run 6.4 km", P.SPORT_RUN, 6400),
            ("Easy run 4.8 km", P.SPORT_RUN, 4800),
            ("W10: Run 8.0 km", P.SPORT_RUN, 8000),
            ("W12: Run 3.2 km", P.SPORT_RUN, 3200),
            ("W11: LONG RUN 16.1 km", P.SPORT_RUN, 16100),
        ],
    )
    def test_a_title_that_states_its_distance(self, title, sport, metres):
        got = P.parse_event(title)
        assert got.sport == sport
        assert got.min_m == metres

    @pytest.mark.parametrize(
        "title, sport",
        [
            ("Long Run - DBRC", P.SPORT_RUN),
            ("Katara Hills - Run - DBRC", P.SPORT_RUN),
            ("Lusail Track - Biking", P.SPORT_RIDE),
            ("Olympic Track Ride", P.SPORT_RIDE),
            ("W1: Olympic Track Ride", P.SPORT_RIDE),
            ("W6: Easy spin (optional)", P.SPORT_RIDE),
            ("Gym before swim", P.SPORT_GYM),
        ],
    )
    def test_a_title_that_states_only_its_sport(self, title, sport):
        assert P.parse_event(title).sport == sport

    def test_the_race_carries_the_half_marathon_distance(self):
        got = P.parse_event(
            "RACE: Ooredoo Doha Half Marathon",
            "Hotel Park, Doha Corniche. Start 07:35. Flat course.",
        )
        assert got.sport == P.SPORT_RUN
        assert got.kind == "race"
        assert got.min_m == P.HALF_MARATHON_M

    def test_an_optional_session_is_marked_optional(self):
        """Counting a skipped optional spin as a missed session makes the plan punish
        the owner for following it."""
        assert P.parse_event("W6: Easy spin (optional)", "Race week - keep it very easy.").optional

    def test_long_run_is_recognised_before_run(self):
        assert P.parse_event("W10: LONG RUN 14.5 km").kind == "long"


class TestWhatItRefusesToRead:
    def test_the_gym_routine_does_not_become_a_ten_kilometre_run(self):
        """`1x8-10 per leg` and `2x10-12` are sets, not kilometres. The unit is required
        precisely so a 2.5 KB gym description cannot prescribe a run."""
        got = P.parse_event("Gym before swim", GYM_ROUTINE)
        assert got.sport == P.SPORT_GYM
        assert got.min_m is None

    def test_the_long_runs_standing_note_does_not_set_this_weeks_target(self):
        """It names six distances — 6.4, 16.1, 18, 14-15, 19-20, 18-20 — and none of
        them is this week's. The text says so itself: the target is on Monday's event."""
        got = P.parse_event("Long Run - DBRC", LONG_RUN_STANDING_NOTE)
        assert got.sport == P.SPORT_RUN
        assert got.min_m is None

    def test_a_title_with_nothing_in_it_is_unparsed(self):
        pres, status = P.resolve("Reminder", "", FRIDAY, {})
        assert status == "unparsed"
        assert pres.sport is None


class TestPrecedence:
    def test_the_week_note_beats_the_recurring_titles_fixed_text(self):
        """`Long Run - DBRC` is the same string all twelve weeks. Monday's note is what
        knows which week it is."""
        note = P.parse_week_note(WEEK_8_PEAK)
        pres, status = P.resolve("Long Run - DBRC", LONG_RUN_STANDING_NOTE, FRIDAY, note)
        assert status == "ok"
        # While Higdon's plan is on, his number is the target (12.9), not the owner's 19-20.
        assert (pres.min_m, pres.max_m) == (12900, 12900)
        assert pres.sport == P.SPORT_RUN

    def test_a_hint_line_beats_everything(self):
        note = P.parse_week_note(WEEK_8_PEAK)
        pres, status = P.resolve(
            "Long Run - DBRC",
            LONG_RUN_STANDING_NOTE + "\nGA: fri sport=run dist=22km kind=long",
            FRIDAY,
            note,
        )
        assert status == "ok"
        assert pres.min_m == 22000
        assert pres.source == "hint"

    def test_a_hint_range_is_kept_as_a_range(self):
        pres, _ = P.resolve("Long Run - DBRC", "GA: fri sport=run dist=18-20km", FRIDAY, {})
        assert (pres.min_m, pres.max_m) == (18000, 20000)

    def test_the_title_supplies_what_the_week_note_left_out(self):
        """The Wednesday segment names a ride but no distance; the title is the only
        place the sport is stated unambiguously. Neither alone is enough."""
        note = P.parse_week_note(WEEK_7)
        pres, status = P.resolve("Lusail Track - Biking", "", WEDNESDAY, note)
        assert status == "ok"
        assert pres.sport == P.SPORT_RIDE

    def test_a_titles_own_distance_stands_when_the_note_is_silent_for_that_day(self):
        note = P.parse_week_note(WEEK_7)
        pres, _ = P.resolve("W11: LONG RUN 16.1 km", "", 3, note)  # Thursday: not in the note
        assert pres.min_m == 16100


class TestWeekIndex:
    def test_notes_are_indexed_by_the_week_they_govern(self):
        rows = [
            {"day": "2026-12-07", "description": WEEK_7},
            {"day": "2026-12-14", "description": WEEK_8_PEAK},
            {"day": "2026-12-11", "description": LONG_RUN_STANDING_NOTE},
        ]
        index = P.week_notes_by_week(rows)
        assert set(index) == {"2026-W50", "2026-W51"}
        assert index["2026-W50"][FRIDAY].min_m == 18000
        assert index["2026-W51"][FRIDAY].min_m == 19000


class TestDaysWithTwoSports:
    """Every Monday here is an easy run *and* a gym session, and the week note speaks
    for the day, not for one event on it."""

    def test_the_gym_does_not_inherit_mondays_running_target(self):
        note = P.parse_week_note(WEEK_7)
        pres, status = P.resolve("Gym before swim", GYM_ROUTINE, MONDAY, note)
        assert pres.sport == P.SPORT_GYM
        assert pres.min_m is None

    def test_the_run_on_that_same_monday_still_gets_it(self):
        note = P.parse_week_note(WEEK_7)
        pres, _ = P.resolve("Easy run 7.2 km", "", MONDAY, note)
        assert (pres.sport, pres.min_m) == (P.SPORT_RUN, 7200)

    def test_an_event_with_no_sport_of_its_own_still_takes_the_note(self):
        note = P.parse_week_note(WEEK_7)
        pres, _ = P.resolve("Session", "", FRIDAY, note)
        assert pres.min_m == 11300  # Higdon's, while his plan is on


class TestTuesdayClubDistance:
    def test_the_club_distance_beats_the_ladder_quoted_beside_it(self):
        """Real description on the Tuesday series: it quotes Higdon's ladder, then says
        what the club actually runs. The club number is the one that happens."""
        description = (
            "Higdon Novice 1 midweek run. Plan asks 4.8 km (wk1) rising to 8 km "
            "(wk9-11); the club runs 8-10 km, which is at or above plan all the way "
            "through - no need to add anything. This week's exact numbers are on "
            "Monday's event."
        )
        got = P.parse_event("Katara Hills - Run - DBRC", description)
        assert (got.min_m, got.max_m) == (8000, 10000)


class TestQuotedVersusOwnAnnotation:
    """Found only once the live calendar was read: the real text puts the owner's own
    note and Higdon's prescription in two parentheticals side by side."""

    WEEK_9 = (
        "HIGDON NOVICE 1 - WEEK 9 of 12 || MON (today): 8.0 km easy. || FRI - DBRC long "
        "run: target 16 km (recovery)  (Higdon prescribes 10K race - lower than you "
        "already run). || SUN = rest."
    )

    def test_a_quoted_race_does_not_make_the_session_a_race(self):
        """`(Higdon prescribes 10K race …)` turned 25 December's recovery long run into
        a race, which would have weighted it five times its worth."""
        note = P.parse_week_note(self.WEEK_9)
        assert note[FRIDAY].kind != "race"
        assert note[FRIDAY].min_m == 16000

    def test_the_owners_own_parenthetical_still_counts(self):
        week_6 = (
            "HIGDON NOVICE 1 - WEEK 6 of 12 || FRI - DBRC long run: target 14 km (easy "
            "week)  (Higdon prescribes 5K race - lower than you already run). || SUN = rest."
        )
        note = P.parse_week_note(week_6)
        assert note[FRIDAY].kind != "race"
        assert note[FRIDAY].min_m == 14000

    def test_the_real_race_is_still_a_race(self):
        note = P.parse_week_note(WEEK_12_RACE)
        assert note[FRIDAY].kind == "race"


class TestHigdonIsTheBase:
    """While Higdon's plan is on, every day is measured against his number: the club's
    8-10 km on Tuesday and the owner's higher Friday target are what happens, not what is
    owed."""

    def test_tuesday_is_higdons_number_not_the_clubs(self):
        note = P.parse_week_note(WEEK_7)
        pres, status = P.resolve(
            "Katara Hills - Run - DBRC",
            "Higdon Novice 1 midweek run. Plan asks 4.8 km (wk1) ... the club runs 8-10 km",
            TUESDAY, note,
        )
        assert status == "ok" and pres.sport == P.SPORT_RUN
        assert (pres.min_m, pres.max_m) == (7200, 7200)

    def test_friday_is_higdons_number_not_the_owners(self):
        note = P.parse_week_note(WEEK_7)
        pres, _ = P.resolve("Long Run - DBRC", LONG_RUN_STANDING_NOTE, FRIDAY, note)
        assert (pres.min_m, pres.max_m) == (11300, 11300)
        assert pres.kind == "long"

    def test_a_number_with_no_unit_or_a_race_name_is_read(self):
        assert P.find_plan_distance("Higdon prescribes 6.4 - lower than you run") == 6400
        assert P.find_plan_distance("(Higdon prescribes 5K race - lower)") == 5000
        assert P.find_plan_distance("Higdon prescribes HALF MARATHON") == P.HALF_MARATHON_M
        assert P.find_plan_distance("target 18 km") is None

    def test_a_gym_session_is_never_given_the_runs_number(self):
        note = P.parse_week_note(WEEK_7)
        pres, _ = P.resolve("Gym before swim", GYM_ROUTINE, MONDAY, note)
        assert pres.sport == P.SPORT_GYM and pres.min_m is None

    def test_a_hint_still_beats_the_plan(self):
        note = P.parse_week_note(WEEK_7)
        pres, _ = P.resolve("Long Run - DBRC", "GA: fri sport=run dist=14km", FRIDAY, note)
        assert pres.min_m == 14000

    def test_a_week_without_a_plan_keeps_the_calendars_number(self):
        note = P.parse_week_note(BASE_PHASE)
        assert (note[TUESDAY].min_m, note[TUESDAY].max_m) == (8000, 10000)
        assert note[TUESDAY].plan_m is None

    def test_a_dated_one_off_with_its_own_distance_keeps_it(self):
        """`W12: Run 3.2 km` is the taper week's own entry, more specific than the note."""
        note = P.parse_week_note(WEEK_7)
        pres, _ = P.resolve("W12: Run 3.2 km", "", TUESDAY, note)
        assert pres.min_m == 3200
