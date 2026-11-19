# Roadmap

Where Odeda is heading. These are directions, not promises and not dates: the order
follows what people ask for. If something here matters to you, say so in
[Discussions](https://github.com/mshinoy/odeda/discussions) or on the matching issue;
that is how it moves up.

Odeda stays what it is: analytics for athletes who follow a plan, run by one person on
their own machine. It reads your plan and your numbers and tells you where you stand.
It does not write plans or coach.

## Easier to start

- **Garmin's own data export.** Import the ZIP from Garmin's "Export Your Data", so a
  first run needs no Garmin login at all. The import command exists; the aim is to make
  it a first-class way in, from the Settings page.
- **A faster first run.** Less hand-editing of `.env`. A first-run checklist and a
  Settings page for time zone, heart rate and password are already in.
- **A live demo.** A hosted copy with synthetic data you can click through, running in a
  read-only demo mode.

## Smarter about your plan and your races

- **One plan per race.** When you have more than one race in the calendar, each gets its
  own block, forecast and taper, with the history carried over.
- **Moved and swapped runs.** Judge a session fairly when you moved it a few days or
  swapped it with another.
- **Goals.** "A 50-minute 10K": set a target and see what your load, trend and plan say
  about it.
- **Training insights.** A few plain sentences instead of charts to read: load jumped
  this week, the long run is far longer than the last, you are due an easy day.
- **Weather.** Weather is already stored per run and shown on the map as headwind. Next
  comes what it did to your pace.

## Comes to you

- **Summaries.** A short weekly or monthly note: the week against the plan, load and
  recovery in a few lines.
- **Shareable pages and images.** A clean image or page for a run or a ride, in the
  spirit of the flyover video export.

## Wider reach

- **Miles as well as kilometres**, with min/mile and feet of climb.
- **Gear components.** Chains, tyres and cleats, not only shoes.
- **Other languages.**
- **More sources.** Strava and others, next to Garmin.

## Later, and not promised

- **Edits written back to a calendar.** Today a change you make in Odeda stays in
  Odeda. Writing it back to Google Calendar or another calendar is possible, and not
  planned yet.
- **The official Garmin API**, once there is real demand to justify applying for it.

## Not planned

Several people on one server, followers and feeds, privacy levels, sign-up by email,
password reset by email and single sign-on. All of it serves a service with many users.
Odeda is one person's data in one container with one password, which is why it starts in
a minute. If a household wants two people, they run two containers.
