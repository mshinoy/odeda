"""Uploading a plan: a file that becomes the plan from a day the owner picks (D31)."""

from __future__ import annotations

from datetime import date

import pytest

from odeda.ingest import plan_ics, plan_upload

from tests.test_plan_api import FakeTransport, client, planned  # noqa: F401

TODAY = date(2026, 10, 5)

CSV = (
    "date,title,distance_km,notes\n"
    "2026-10-12,Easy run,5,\n"
    "2026-10-14,Easy run,6.5,\n"
    "2026-10-16,Long run,12,Higdon week 2\n"
)

ICS = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\n"
    "BEGIN:VEVENT\r\nUID:n1\r\nDTSTART;TZID=Asia/Qatar:20261013T050000\r\n"
    "DTEND;TZID=Asia/Qatar:20261013T060000\r\nSUMMARY:Easy run 8 km\r\nEND:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)


def live_days(client) -> dict[str, dict]:
    return {r["day"] + r["title"]: r for r in client.get("/api/plan/sessions").json()["sessions"]}


def post(client, path: str, content: str, effective_day: str, label: str | None = None):
    return client.post(
        f"/api/plan/upload{path}",
        json={"content": content, "effective_day": effective_day, "label": label},
    )


class TestReading:
    def test_a_csv_puts_its_distance_where_the_parser_looks(self):
        fmt, rows = plan_upload.read_plan(CSV, TODAY)
        assert fmt == "csv"
        assert [r.title for r in rows][:2] == ["Easy run 5 km", "Easy run 6.5 km"]

    def test_the_format_is_found_from_the_file_not_its_name(self):
        assert plan_upload.read_plan(ICS, TODAY)[0] == "ics"

    @pytest.mark.parametrize(
        "text, words",
        [
            ("", "empty"),
            ("title\nEasy run\n", "`date` column"),
            ("date,title\nfriday,Easy run\n", "not a date"),
            ("date,title,km\n2026-10-12,Easy run,lots\n", "not a distance"),
            ("date,title\n2026-10-12,\n", "title is empty"),
            ("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", "no sessions"),
        ],
    )
    def test_a_bad_file_is_refused_in_words(self, text, words):
        with pytest.raises(plan_upload.PlanUploadError, match=words):
            plan_upload.read_plan(text, TODAY)

    def test_a_row_numbers_its_own_mistake(self):
        with pytest.raises(plan_upload.PlanUploadError, match="row 3"):
            plan_upload.read_plan("date,title\n2026-10-12,Run\nsoon,Run\n", TODAY)


class TestPreview:
    def test_says_what_would_change_and_writes_nothing(self, planned, store):
        before = live_days(planned)
        r = post(planned, "/preview", CSV, "2026-10-12")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "preview"
        assert body["sessions"] == 3 and body["skipped_before"] == 0
        assert body["first_day"] == "2026-10-12" and body["last_day"] == "2026-10-16"
        assert live_days(planned) == before

    def test_counts_what_it_leaves_out_before_the_day(self, planned):
        body = post(planned, "/preview", CSV, "2026-10-14").json()
        assert body["sessions"] == 2 and body["skipped_before"] == 1

    def test_a_day_past_everything_is_refused(self, planned):
        r = post(planned, "/preview", CSV, "2027-01-01")
        assert r.status_code == 422 and "no sessions on or after" in r.json()["detail"]

    def test_warns_when_the_new_plan_has_no_race(self, planned, store):
        store.conn.execute(
            "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, title, sport, kind, "
            "planned_min_m, planned_max_m, optional, recurring, parse_source, parse_status) "
            "VALUES (1, 'race', '2027-01-15', '2027-01-15', 'RACE: Test Half', 'running', "
            "'race', 21097, 21097, 0, 0, 'title', 'ok')"
        )
        store.conn.commit()
        assert post(planned, "/preview", CSV, "2026-10-12").json()["race_lost"] is True
        with_race = CSV + "2027-01-15,RACE: Test Half,21.1,\n"
        body = post(planned, "/preview", with_race, "2026-10-12").json()
        assert body["race_lost"] is False and body["race"]["date"] == "2027-01-15"


class TestApply:
    def test_the_new_plan_takes_over_from_the_day_and_earlier_weeks_keep_theirs(self, planned):
        r = post(planned, "", CSV, "2026-10-12", "Coach block")
        assert r.status_code == 200 and r.json()["status"] == "ok"
        titles = {x["title"] for x in planned.get("/api/plan/sessions").json()["sessions"]}
        assert "Easy run 7.2 km" in titles  # 28 Sep: before the day, still the old plan's
        assert "Long Run - DBRC" in titles  # 2 Oct: likewise
        assert "Easy run 6.5 km" in titles  # 14 Oct: the new plan's

    def test_the_old_plan_stops_from_the_day_but_is_kept(self, planned, store):
        store.conn.execute(
            "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, title, sport, kind, "
            "planned_min_m, planned_max_m, optional, recurring, parse_source, parse_status) "
            "VALUES (1, 'late', '2026-10-20', '2026-10-20', 'Old plan run', 'running', 'easy', "
            "5000, 5000, 0, 0, 'title', 'ok')"
        )
        store.conn.commit()
        post(planned, "", CSV, "2026-10-12")
        titles = {x["title"] for x in planned.get("/api/plan/sessions").json()["sessions"]}
        assert "Old plan run" not in titles
        row = store.query("SELECT withdrawn_at FROM plan_sessions WHERE uid = 'late'")[0]
        assert row["withdrawn_at"] is not None  # withdrawn, not deleted

    def test_the_old_source_is_kept_and_switched_off(self, planned, store):
        plan_ics.set_start_day(store, "2026-09-01")
        post(planned, "", CSV, "2026-10-12", "Coach block")
        sources = store.query("SELECT kind, enabled FROM plan_sources ORDER BY id")
        assert [(s["kind"], s["enabled"]) for s in sources] == [("ics", 0), ("upload", 1)]
        source = planned.get("/api/plan").json()["source"]
        assert source["kind"] == "upload" and source["label"] == "Coach block"
        assert source["url_masked"] == "Coach block"
        assert source["start_day"] == "2026-09-01"  # carried over, so past weeks stay in view

    def test_a_sync_leaves_an_uploaded_plan_alone(self, planned, store):
        post(planned, "", CSV, "2026-10-12")
        result = plan_ics.sync_plan(store, FakeTransport(), today=TODAY)
        assert result["status"] == "skipped"
        assert "Easy run 6.5 km" in {
            x["title"] for x in planned.get("/api/plan/sessions").json()["sessions"]
        }

    def test_an_ics_file_works_the_same_way(self, planned):
        assert post(planned, "", ICS, "2026-10-12").status_code == 200
        titles = {x["title"] for x in planned.get("/api/plan/sessions").json()["sessions"]}
        assert "Easy run 8 km" in titles

    def test_uploading_the_same_file_twice_changes_nothing(self, planned, store):
        post(planned, "", CSV, "2026-10-12")
        first = live_days(planned)
        post(planned, "", CSV, "2026-10-12")
        assert live_days(planned) == first
        assert store.scalar("SELECT COUNT(*) FROM plan_sources WHERE kind = 'upload'") == 1

    def test_the_owners_own_sessions_after_the_day_stop_too(self, planned):
        planned.post(
            "/api/plan/sessions", json={"day": "2026-10-20", "sport": "running", "title": "Mine"}
        )
        body = post(planned, "/preview", CSV, "2026-10-12").json()
        assert body["own_removed"] == 1
        post(planned, "", CSV, "2026-10-12")
        assert "Mine" not in {x["title"] for x in planned.get("/api/plan/sessions").json()["sessions"]}

    def test_a_refused_upload_changes_nothing(self, planned, store):
        before = live_days(planned)
        assert post(planned, "", "date,title\nsoon,Run\n", "2026-10-12").status_code == 422
        assert live_days(planned) == before
        assert store.scalar("SELECT COUNT(*) FROM plan_sources WHERE kind = 'upload'") == 0
