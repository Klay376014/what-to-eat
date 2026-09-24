import { describe, expect, test } from "vite-plus/test";
import { contentOutsideRange, pickDefaultTrip, type Trip } from "./trip.ts";

function trip(overrides: Partial<Trip> & Pick<Trip, "id">): Trip {
  return {
    name: overrides.id,
    startDate: null,
    endDate: null,
    timezone: "Asia/Taipei",
    myRole: "member",
    organiserName: null,
    ...overrides,
  };
}

describe("pickDefaultTrip", () => {
  const now = new Date("2026-10-03T03:00:00Z"); // 2026-10-03 11:00 in Taipei

  test("there is nothing to open when the user has no trips", () => {
    expect(pickDefaultTrip([], now)).toBeUndefined();
  });

  test("opens the trip happening now over one starting later", () => {
    const upcoming = trip({ id: "seoul", startDate: "2026-10-10", endDate: "2026-10-12" });
    const current = trip({ id: "tokyo", startDate: "2026-10-01", endDate: "2026-10-05" });

    expect(pickDefaultTrip([upcoming, current], now)?.id).toBe("tokyo");
  });

  test("a trip's first and last days both count as happening now", () => {
    const starting = trip({ id: "starts-today", startDate: "2026-10-03", endDate: "2026-10-06" });
    const ending = trip({ id: "ends-today", startDate: "2026-09-28", endDate: "2026-10-03" });

    expect(pickDefaultTrip([starting], now)?.id).toBe("starts-today");
    expect(pickDefaultTrip([ending], now)?.id).toBe("ends-today");
  });

  test("with nothing happening now, opens the next trip to start", () => {
    const later = trip({ id: "december", startDate: "2026-12-20", endDate: "2026-12-24" });
    const sooner = trip({ id: "october", startDate: "2026-10-10", endDate: "2026-10-12" });
    const past = trip({ id: "august", startDate: "2026-08-01", endDate: "2026-08-03" });

    expect(pickDefaultTrip([later, past, sooner], now)?.id).toBe("october");
  });

  test("'now' is judged on the trip's own calendar, not the viewer's", () => {
    // 2026-10-03 23:30 in Taipei is already 2026-10-04 00:30 in Tokyo.
    const lateEvening = new Date("2026-10-03T15:30:00Z");
    const tokyo = trip({
      id: "tokyo",
      startDate: "2026-10-04",
      endDate: "2026-10-06",
      timezone: "Asia/Tokyo",
    });
    const taipeiLater = trip({ id: "taipei", startDate: "2026-10-04", endDate: "2026-10-04" });

    expect(pickDefaultTrip([taipeiLater, tokyo], lateEvening)?.id).toBe("tokyo");
  });

  test("when several trips are happening now, opens the one that started most recently", () => {
    const longTrip = trip({ id: "japan", startDate: "2026-09-25", endDate: "2026-10-10" });
    const sideTrip = trip({ id: "kyoto", startDate: "2026-10-02", endDate: "2026-10-04" });

    expect(pickDefaultTrip([longTrip, sideTrip], now)?.id).toBe("kyoto");
  });

  test("with no current or upcoming trip, an undated everyday trip is opened", () => {
    const past = trip({ id: "august", startDate: "2026-08-01", endDate: "2026-08-03" });
    const everyday = trip({ id: "everyday" });

    expect(pickDefaultTrip([past, everyday], now)?.id).toBe("everyday");
  });

  test("with only past trips, the most recently ended one is opened", () => {
    const older = trip({ id: "july", startDate: "2026-07-01", endDate: "2026-07-03" });
    const recent = trip({ id: "august", startDate: "2026-08-01", endDate: "2026-08-03" });

    expect(pickDefaultTrip([older, recent], now)?.id).toBe("august");
  });
});

describe("contentOutsideRange", () => {
  const items = [
    { id: "a", date: "2026-10-01", label: "Lunch on 1 Oct" },
    { id: "b", date: "2026-10-03", label: "Dinner on 3 Oct" },
    { id: "c", date: "2026-10-05", label: "Breakfast on 5 Oct" },
  ];

  test("nothing is affected when every item stays inside the new dates", () => {
    expect(contentOutsideRange(items, { startDate: "2026-10-01", endDate: "2026-10-05" })).toEqual(
      [],
    );
  });

  test("lists the items that would fall before or after the new dates", () => {
    const affected = contentOutsideRange(items, { startDate: "2026-10-02", endDate: "2026-10-04" });

    expect(affected.map((item) => item.label)).toEqual(["Lunch on 1 Oct", "Breakfast on 5 Oct"]);
  });

  test("removing the dates leaves nothing outside them", () => {
    expect(contentOutsideRange(items, { startDate: null, endDate: null })).toEqual([]);
  });
});
