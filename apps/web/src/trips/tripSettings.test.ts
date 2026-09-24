import { describe, expect, test } from "vite-plus/test";
import { defaultTimeZone, timeZoneOptions, validateTripSettings } from "./tripSettings.ts";

describe("timezone choices", () => {
  test("offers IANA region/city zones", () => {
    const zones = timeZoneOptions();

    expect(zones).toContain("Asia/Tokyo");
    expect(zones).toContain("America/New_York");
  });

  test("offers nothing the database would refuse for a trip", () => {
    const refused = timeZoneOptions().filter(
      (zone) => !zone.includes("/") || zone.startsWith("Etc/"),
    );

    expect(refused).toEqual([]);
  });

  test("defaults to the browser's zone", () => {
    expect(defaultTimeZone("Asia/Taipei")).toBe("Asia/Taipei");
  });

  test("leaves the choice to the user when the browser's zone is not a place", () => {
    expect(defaultTimeZone("UTC")).toBe("");
    expect(defaultTimeZone("Etc/GMT-8")).toBe("");
  });
});

describe("validateTripSettings", () => {
  const valid = {
    name: "Tokyo",
    startDate: "2026-10-01",
    endDate: "2026-10-05",
    timezone: "Asia/Tokyo",
  };

  test("accepts a named trip with a date range and a timezone", () => {
    expect(validateTripSettings(valid)).toEqual({});
  });

  test("accepts a trip without dates", () => {
    expect(validateTripSettings({ ...valid, startDate: null, endDate: null })).toEqual({});
  });

  test("requires a name that is not just spaces", () => {
    expect(validateTripSettings({ ...valid, name: "   " })).toHaveProperty("name");
  });

  test("refuses a name longer than 100 characters", () => {
    expect(validateTripSettings({ ...valid, name: "x".repeat(101) })).toHaveProperty("name");
    expect(validateTripSettings({ ...valid, name: ` ${"x".repeat(100)} ` })).toEqual({});
  });

  test("requires both dates or neither", () => {
    expect(validateTripSettings({ ...valid, endDate: null })).toHaveProperty("endDate");
    expect(validateTripSettings({ ...valid, startDate: null })).toHaveProperty("startDate");
  });

  test("refuses an end date before the start date", () => {
    expect(
      validateTripSettings({ ...valid, startDate: "2026-10-05", endDate: "2026-10-01" }),
    ).toHaveProperty("endDate");
  });

  test("requires a timezone", () => {
    expect(validateTripSettings({ ...valid, timezone: "" })).toHaveProperty("timezone");
  });
});
