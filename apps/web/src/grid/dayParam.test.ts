import { afterEach, describe, expect, test } from "vite-plus/test";
import { readDayParam, writeDayParam } from "./dayParam.ts";

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("readDayParam", () => {
  test("reads the day a link asks for in this trip", () => {
    history.replaceState(null, "", "/?trip=tokyo&day=2026-10-16");
    expect(readDayParam("tokyo")).toBe("2026-10-16");
  });

  test("is null when the link asks for no day", () => {
    history.replaceState(null, "", "/?trip=tokyo");
    expect(readDayParam("tokyo")).toBeNull();
  });

  test("ignores a day that belongs to another trip", () => {
    history.replaceState(null, "", "/?trip=tokyo&day=2026-10-16");
    expect(readDayParam("seoul")).toBeNull();
  });

  test("ignores a day that names no trip at all", () => {
    history.replaceState(null, "", "/?day=2026-10-16");
    expect(readDayParam("tokyo")).toBeNull();
  });

  test("ignores anything that is not a real calendar day", () => {
    for (const day of ["tomorrow", "2026-10-1", "2026-13-01", "2026-02-30", "2026-10-16T00:00"]) {
      history.replaceState(null, "", `/?trip=tokyo&day=${encodeURIComponent(day)}`);
      expect(readDayParam("tokyo"), day).toBeNull();
    }
  });
});

describe("writeDayParam", () => {
  test("puts the trip and day in the address without adding a history entry", () => {
    const before = history.length;
    writeDayParam("tokyo", "2026-10-03");
    const params = new URLSearchParams(location.search);
    expect(params.get("trip")).toBe("tokyo");
    expect(params.get("day")).toBe("2026-10-03");
    expect(history.length).toBe(before);
  });

  test("keeps the rest of the address as it is", () => {
    history.replaceState(null, "", "/somewhere?invite=abc#top");
    writeDayParam("tokyo", "2026-10-03");
    expect(location.pathname).toBe("/somewhere");
    expect(new URLSearchParams(location.search).get("invite")).toBe("abc");
    expect(readDayParam("tokyo")).toBe("2026-10-03");
    expect(location.hash).toBe("#top");
  });

  test("replaces the trip and day already there", () => {
    history.replaceState(null, "", "/?trip=tokyo&day=2026-10-01");
    writeDayParam("seoul", "2026-12-21");
    expect(readDayParam("tokyo")).toBeNull();
    expect(readDayParam("seoul")).toBe("2026-12-21");
  });
});
