import { describe, expect, it } from "vitest";
import type { WeatherReading } from "@/api/queries/useActivityWeather";
import { mugginess, weatherHeadline, weatherRows } from "@/features/activity/weather";

const reading = (over: Partial<WeatherReading> = {}): WeatherReading => ({
  source: "archive",
  temp_c: 29.4,
  feels_like_c: 33.9,
  humidity_pct: 74,
  dew_point_c: 24.4,
  wind_kmh: 13,
  wind_dir_deg: 142,
  gust_kmh: 22.7,
  precip_mm: 0,
  cloud_pct: 74,
  ...over,
});

describe("weatherHeadline", () => {
  it("gives the temperature, how heavy the air was, and the wind", () => {
    expect(weatherHeadline(reading())).toBe("29°C · oppressive · 13 km/h SE");
  });

  it("says calm under 5 km/h and leaves comfortable air unsaid", () => {
    expect(weatherHeadline(reading({ wind_kmh: 3, dew_point_c: 12 }))).toBe("29°C · calm");
  });

  it("mentions rain only when it was more than a trace", () => {
    expect(weatherHeadline(reading({ precip_mm: 1.2, dew_point_c: 10 }))).toContain("rain");
    expect(weatherHeadline(reading({ precip_mm: 0.1, dew_point_c: 10 }))).not.toContain("rain");
  });

  it("copes with a reading that is mostly empty", () => {
    expect(
      weatherHeadline(
        reading({ temp_c: null, dew_point_c: null, wind_kmh: null, wind_dir_deg: null }),
      ),
    ).toBe("");
  });
});

describe("mugginess", () => {
  it("steps up with the dew point", () => {
    expect([14, 18, 21, 24].map(mugginess)).toEqual([null, "humid", "very humid", "oppressive"]);
    expect(mugginess(null)).toBeNull();
  });
});

describe("weatherRows", () => {
  it("adds feels-like only when it differs by two degrees or more", () => {
    expect(weatherRows(reading())[0]?.value).toBe("29°C, feels like 34°C");
    expect(weatherRows(reading({ feels_like_c: 30 }))[0]?.value).toBe("29°C");
  });

  it("names the wind's origin and gusts", () => {
    const wind = weatherRows(reading()).find((r) => r.label === "Wind");
    expect(wind?.value).toBe("13 km/h from the SE, gusts 23 km/h");
  });
});
