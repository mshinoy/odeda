# Courses

A race's course as a GPX file. The pacing plan reads it to find the turns and mark them on
the kilometre they fall in. Without one the plan is even splits and says so.

The app looks for `<data dir>/courses/<race date>.gpx`, where the race date is the day of
the race in your training calendar (`2027-01-15.gpx`). The data directory is `/data` in the
container, so for the Docker install:

```bash
docker cp courses/doha-half-marathon-2027-approx.gpx garmin-analytics:/data/courses/2027-01-15.gpx
```

(Make the folder first with `docker exec garmin-analytics mkdir -p /data/courses`.)

A course belongs to a race and not to the app, so nothing here is read until it is in the
data directory.

## `doha-half-marathon-2027-approx.gpx`

The Doha Marathon by Ooredoo, 21 km, 15 January 2027. **Approximate.** It was traced from the
organiser's published course map and placed on OpenStreetMap landmarks, so it is accurate to
roughly 30 to 80 m and was not surveyed. Its length is 21.06 km against the official 21.10 km.
It has no elevation: Doha is flat. If the organiser publishes an official GPX, use that.
