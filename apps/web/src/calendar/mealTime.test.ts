import { describe, expect, it } from "vite-plus/test";
import { mealStart, mealTimes, zonedIso, zonedInstant } from "./mealTime.ts";

describe("a meal's start time", () => {
  it("is its slot's default when nobody set one", () => {
    expect(mealStart({ slot: "breakfast", startTime: null })).toBe("08:00");
    expect(mealStart({ slot: "lunch", startTime: null })).toBe("12:00");
    expect(mealStart({ slot: "dinner", startTime: null })).toBe("19:00");
    expect(mealStart({ slot: "other", startTime: null })).toBe("15:00");
  });

  it("is the meal's own time when one was set", () => {
    expect(mealStart({ slot: "dinner", startTime: "20:30" })).toBe("20:30");
  });

  it("reads a database time with seconds as hours and minutes", () => {
    expect(mealStart({ slot: "dinner", startTime: "20:30:00" })).toBe("20:30");
  });
});

describe("a wall-clock time on the trip's calendar", () => {
  it("is that time in the trip's timezone, not the browser's", () => {
    // 19:00 in Tokyo (UTC+9) is 10:00 UTC; in Taipei it would be 11:00.
    expect(zonedInstant("2026-10-03", "19:00", "Asia/Tokyo").toISOString()).toBe(
      "2026-10-03T10:00:00.000Z",
    );
  });

  it("follows the offset of that very day across a DST change", () => {
    // New York springs forward on Sunday 8 March 2026: breakfast is 08:00
    // EST (UTC−5) on Saturday and 08:00 EDT (UTC−4) on Sunday.
    expect(zonedInstant("2026-03-07", "08:00", "America/New_York").toISOString()).toBe(
      "2026-03-07T13:00:00.000Z",
    );
    expect(zonedInstant("2026-03-08", "08:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T12:00:00.000Z",
    );
  });

  it("follows a southern-hemisphere change the other way round", () => {
    // Sydney moves from AEST (UTC+10) to AEDT (UTC+11) on Sunday 4 October 2026.
    expect(zonedInstant("2026-10-03", "19:00", "Australia/Sydney").toISOString()).toBe(
      "2026-10-03T09:00:00.000Z",
    );
    expect(zonedInstant("2026-10-04", "19:00", "Australia/Sydney").toISOString()).toBe(
      "2026-10-04T08:00:00.000Z",
    );
  });

  it("moves a time that the clocks skip forward by the gap", () => {
    // 02:30 does not happen in New York on 8 March 2026; clocks go 02:00 → 03:00.
    expect(zonedInstant("2026-03-08", "02:30", "America/New_York").toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("takes the first of a time that happens twice", () => {
    // 01:30 happens twice in New York on 1 November 2026; the first is EDT.
    expect(zonedInstant("2026-11-01", "01:30", "America/New_York").toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });
});

describe("a meal's start and end", () => {
  it("runs from its start for its slot's length", () => {
    const times = mealTimes({ date: "2026-10-03", slot: "dinner", startTime: null }, "Asia/Tokyo");
    expect(times.start.toISOString()).toBe("2026-10-03T10:00:00.000Z");
    expect(times.end.toISOString()).toBe("2026-10-03T12:00:00.000Z");
    expect(times.localStart).toBe("19:00");
  });

  it("lasts its real length when the clocks change during it", () => {
    // A late-night snack at 01:00 on the night London falls back (25 Oct
    // 2026) lasts an hour of real time, although the clock reads 01:00 again.
    const times = mealTimes(
      { date: "2026-10-25", slot: "other", startTime: "01:00" },
      "Europe/London",
    );
    expect(times.start.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(times.end.toISOString()).toBe("2026-10-25T01:00:00.000Z");
  });
});

describe("an instant written for the trip's calendar", () => {
  it("is the local time with that moment's offset", () => {
    expect(zonedIso(new Date("2026-10-03T10:00:00Z"), "Asia/Tokyo")).toBe(
      "2026-10-03T19:00:00+09:00",
    );
    expect(zonedIso(new Date("2026-03-08T12:00:00Z"), "America/New_York")).toBe(
      "2026-03-08T08:00:00-04:00",
    );
    expect(zonedIso(new Date("2026-06-01T11:30:00Z"), "Asia/Kolkata")).toBe(
      "2026-06-01T17:00:00+05:30",
    );
  });
});
