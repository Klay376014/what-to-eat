import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  captureMealLink,
  clearPendingMealLink,
  pendingMealLink,
  readMealLink,
} from "./mealLink.ts";

const TRIP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MEAL = "a0000000-0000-0000-0000-000000000001";

function openAt(address: string) {
  window.history.replaceState(null, "", address);
}

afterEach(() => {
  clearPendingMealLink();
  openAt("/");
});

describe("readMealLink", () => {
  test("an email's link names the trip, the day and the meal", () => {
    expect(readMealLink(`?trip=${TRIP}&day=2026-10-03&meal=${MEAL}`)).toEqual({
      tripId: TRIP,
      day: "2026-10-03",
      mealId: MEAL,
    });
  });

  test("anything less, or malformed, is not a meal link", () => {
    expect(readMealLink(`?trip=${TRIP}&day=2026-10-03`)).toBeNull();
    expect(readMealLink(`?day=2026-10-03&meal=${MEAL}`)).toBeNull();
    expect(readMealLink(`?trip=${TRIP}&day=2026-02-30&meal=${MEAL}`)).toBeNull();
    expect(readMealLink(`?trip=${TRIP}&day=2026-10-03&meal=not-a-meal`)).toBeNull();
  });
});

describe("a meal link in the address at startup", () => {
  test("is kept for after sign-in, and the meal taken out of the address bar", () => {
    openAt(`/app/?trip=${TRIP}&day=2026-10-03&meal=${MEAL}#top`);

    captureMealLink();

    expect(pendingMealLink()).toEqual({ tripId: TRIP, day: "2026-10-03", mealId: MEAL });
    expect(window.sessionStorage.getItem("what-to-eat:pending-meal")).toContain(MEAL);
    // The trip and day stay: they are the grid's own address.
    expect(window.location.search).toBe(`?trip=${TRIP}&day=2026-10-03`);
    expect(window.location.hash).toBe("#top");
  });

  test("survives the sign-in round trip, which comes back to the bare address", () => {
    openAt(`/?trip=${TRIP}&day=2026-10-03&meal=${MEAL}`);
    captureMealLink();

    openAt("/?code=abc");
    captureMealLink();

    expect(pendingMealLink()?.mealId).toBe(MEAL);
  });

  test("once used, is forgotten", () => {
    openAt(`/?trip=${TRIP}&day=2026-10-03&meal=${MEAL}`);
    captureMealLink();

    clearPendingMealLink();

    expect(pendingMealLink()).toBeNull();
  });

  test("with no meal link, nothing is kept", () => {
    openAt(`/?trip=${TRIP}&day=2026-10-03`);

    captureMealLink();

    expect(pendingMealLink()).toBeNull();
  });
});
