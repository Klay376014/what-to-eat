import { afterEach, describe, expect, test } from "vite-plus/test";
import { readDayParam, writeDayParam } from "./dayParam.ts";

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("readDayParam", () => {
  test("reads the day a link asks for", () => {
    history.replaceState(null, "", "/?day=2026-10-16");
    expect(readDayParam()).toBe("2026-10-16");
  });

  test("is null when the link asks for no day", () => {
    expect(readDayParam()).toBeNull();
  });

  test("ignores anything that is not a real calendar day", () => {
    for (const day of ["tomorrow", "2026-10-1", "2026-13-01", "2026-02-30", "2026-10-16T00:00"]) {
      history.replaceState(null, "", `/?day=${encodeURIComponent(day)}`);
      expect(readDayParam(), day).toBeNull();
    }
  });
});

describe("writeDayParam", () => {
  test("puts the day in the address without adding a history entry", () => {
    const before = history.length;
    writeDayParam("2026-10-03");
    expect(location.search).toBe("?day=2026-10-03");
    expect(history.length).toBe(before);
  });

  test("keeps the rest of the address as it is", () => {
    history.replaceState(null, "", "/somewhere?invite=abc#top");
    writeDayParam("2026-10-03");
    expect(location.pathname).toBe("/somewhere");
    expect(new URLSearchParams(location.search).get("invite")).toBe("abc");
    expect(new URLSearchParams(location.search).get("day")).toBe("2026-10-03");
    expect(location.hash).toBe("#top");
  });

  test("replaces the day already there", () => {
    history.replaceState(null, "", "/?day=2026-10-01");
    writeDayParam("2026-10-05");
    expect(readDayParam()).toBe("2026-10-05");
  });
});
