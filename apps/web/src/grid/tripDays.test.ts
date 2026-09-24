import { describe, expect, test } from "vite-plus/test";
import type { Meal } from "./meal.ts";
import { dayTrail, daySummary, defaultDay, tripDates, type DayTab } from "./tripDays.ts";

let nextId = 1;
function meal(overrides: Partial<Meal> & Pick<Meal, "date" | "slot">): Meal {
  const id = `m${nextId++}`;
  return {
    id,
    tripId: "tokyo",
    label: overrides.slot === "other" ? "Snack" : null,
    position: nextId,
    proposals: 0,
    decidedRestaurant: null,
    ...overrides,
  };
}

const tokyo = { startDate: "2026-10-01", endDate: "2026-10-05" };
const everyday = { startDate: null, endDate: null };

describe("tripDates", () => {
  test("a dated trip has every day from its start to its end", () => {
    expect(tripDates(tokyo, [], "2026-09-01")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
  });

  test("a dated trip's days run across month and year ends", () => {
    expect(tripDates({ startDate: "2026-12-30", endDate: "2027-01-02" }, [], "2026-09-01")).toEqual(
      ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
    );
  });

  test("a one-day trip has one day", () => {
    expect(tripDates({ startDate: "2026-10-01", endDate: "2026-10-01" }, [], "2026-09-01")).toEqual(
      ["2026-10-01"],
    );
  });

  test("a dated trip shows its own days, not today or the days of stranded meals", () => {
    const stranded = meal({ date: "2026-09-20", slot: "dinner" });
    expect(tripDates(tokyo, [stranded], "2026-09-24", ["2026-11-11"])).toHaveLength(5);
  });

  test("an undated trip shows the dates that have meals, plus today, in date order", () => {
    const meals = [
      meal({ date: "2026-09-30", slot: "dinner" }),
      meal({ date: "2026-09-20", slot: "lunch" }),
      meal({ date: "2026-09-30", slot: "other" }),
    ];
    expect(tripDates(everyday, meals, "2026-09-24")).toEqual([
      "2026-09-20",
      "2026-09-24",
      "2026-09-30",
    ]);
  });

  test("an undated trip with no meals still has today", () => {
    expect(tripDates(everyday, [], "2026-09-24")).toEqual(["2026-09-24"]);
  });

  test("an undated trip also shows a day someone went to, once", () => {
    expect(tripDates(everyday, [], "2026-09-24", ["2026-09-26", "2026-09-24"])).toEqual([
      "2026-09-24",
      "2026-09-26",
    ]);
  });
});

describe("dayTrail", () => {
  test("an empty day still lists breakfast, lunch and dinner, none of them planned", () => {
    expect(dayTrail("2026-10-02", []).map((e) => [e.name, e.meal, e.state])).toEqual([
      ["Breakfast", null, { state: "empty" }],
      ["Lunch", null, { state: "empty" }],
      ["Dinner", null, { state: "empty" }],
    ]);
  });

  test("breakfast, lunch and dinner come first in that order, then the day's other meals", () => {
    const meals = [
      meal({ date: "2026-10-02", slot: "other", label: "Afternoon tea", position: 5 }),
      meal({ date: "2026-10-02", slot: "dinner", position: 1 }),
      meal({ date: "2026-10-02", slot: "breakfast", position: 9 }),
      meal({ date: "2026-10-02", slot: "other", label: "Late-night ramen", position: 7 }),
      meal({ date: "2026-10-03", slot: "lunch" }),
    ];
    expect(dayTrail("2026-10-02", meals).map((e) => e.name)).toEqual([
      "Breakfast",
      "Lunch",
      "Dinner",
      "Afternoon tea",
      "Late-night ramen",
    ]);
  });

  test("other meals keep the order they were added in, whatever order they arrive in", () => {
    const meals = [
      meal({ date: "2026-10-02", slot: "other", label: "Airport", position: 30 }),
      meal({ date: "2026-10-02", slot: "other", label: "Tea", position: 10 }),
      meal({ date: "2026-10-02", slot: "other", label: "Snack", position: 20 }),
    ];
    const names = (list: Meal[]) =>
      dayTrail("2026-10-02", list)
        .slice(3)
        .map((e) => e.name);
    expect(names(meals)).toEqual(["Tea", "Snack", "Airport"]);
    expect(names([...meals].reverse())).toEqual(["Tea", "Snack", "Airport"]);
  });

  test("each entry shows its meal's state", () => {
    const meals = [
      meal({ date: "2026-10-02", slot: "breakfast" }),
      meal({ date: "2026-10-02", slot: "lunch", proposals: 3 }),
      meal({ date: "2026-10-02", slot: "dinner", proposals: 2, decidedRestaurant: "Afuri" }),
    ];
    expect(dayTrail("2026-10-02", meals).map((e) => e.state)).toEqual([
      { state: "empty" },
      { state: "discussing", proposals: 3 },
      { state: "decided", restaurant: "Afuri" },
    ]);
  });
});

describe("daySummary", () => {
  const summaryOf = (meals: Meal[]) => daySummary(dayTrail("2026-10-02", meals)).text;

  test("counts every meal not planned yet as a gap, breakfast, lunch and dinner included", () => {
    expect(summaryOf([])).toBe("3 gaps");
    expect(
      summaryOf([
        meal({ date: "2026-10-02", slot: "breakfast", decidedRestaurant: "Cafe" }),
        meal({ date: "2026-10-02", slot: "lunch", decidedRestaurant: "Afuri" }),
      ]),
    ).toBe("1 gap");
  });

  test("an other meal with nothing proposed is a gap too", () => {
    expect(
      summaryOf([
        meal({ date: "2026-10-02", slot: "breakfast", decidedRestaurant: "Cafe" }),
        meal({ date: "2026-10-02", slot: "lunch", decidedRestaurant: "Afuri" }),
        meal({ date: "2026-10-02", slot: "dinner", decidedRestaurant: "Uobei" }),
        meal({ date: "2026-10-02", slot: "other" }),
      ]),
    ).toBe("1 gap");
  });

  test("gaps win over meals still being discussed", () => {
    expect(summaryOf([meal({ date: "2026-10-02", slot: "lunch", proposals: 2 })])).toBe("2 gaps");
  });

  test("with no gaps, counts the meals still being discussed", () => {
    expect(
      summaryOf([
        meal({ date: "2026-10-02", slot: "breakfast", proposals: 1 }),
        meal({ date: "2026-10-02", slot: "lunch", proposals: 4 }),
        meal({ date: "2026-10-02", slot: "dinner", decidedRestaurant: "Uobei" }),
      ]),
    ).toBe("2 open");
  });

  test("a day with every meal decided is done", () => {
    expect(
      summaryOf([
        meal({ date: "2026-10-02", slot: "breakfast", decidedRestaurant: "Cafe" }),
        meal({ date: "2026-10-02", slot: "lunch", decidedRestaurant: "Afuri" }),
        meal({ date: "2026-10-02", slot: "dinner", decidedRestaurant: "Uobei" }),
        meal({ date: "2026-10-02", slot: "other", decidedRestaurant: "Higashiya" }),
      ]),
    ).toBe("Done");
  });
});

describe("defaultDay", () => {
  function tab(date: string, text: "gaps" | "open" | "done"): DayTab {
    const summary = {
      gaps: { gaps: 1, open: 0, text: "1 gap" },
      open: { gaps: 0, open: 1, text: "1 open" },
      done: { gaps: 0, open: 0, text: "Done" },
    }[text];
    return { date, isToday: false, summary };
  }
  const days = [
    tab("2026-10-01", "done"),
    tab("2026-10-02", "open"),
    tab("2026-10-03", "gaps"),
    tab("2026-10-04", "gaps"),
    tab("2026-10-05", "done"),
  ];

  test("a day asked for in the link wins over every other rule", () => {
    expect(defaultDay(tokyo, days, "2026-10-02", "2026-10-04")).toBe("2026-10-04");
    expect(defaultDay(tokyo, days, "2026-09-01", "2026-10-05")).toBe("2026-10-05");
  });

  test("a day asked for that is not one of the trip's days is ignored", () => {
    expect(defaultDay(tokyo, days, "2026-10-02", "2026-11-30")).toBe("2026-10-02");
  });

  test("during the trip, today", () => {
    expect(defaultDay(tokyo, days, "2026-10-05", null)).toBe("2026-10-05");
  });

  test("before the trip, the first day with a gap", () => {
    expect(defaultDay(tokyo, days, "2026-09-24", null)).toBe("2026-10-03");
  });

  test("before the trip with no gaps, the first day still being discussed", () => {
    const noGaps = days.map((d) => (d.summary.gaps > 0 ? tab(d.date, "done") : d));
    expect(defaultDay(tokyo, noGaps, "2026-09-24", null)).toBe("2026-10-02");
  });

  test("before the trip with everything decided, day 1", () => {
    const allDone = days.map((d) => tab(d.date, "done"));
    expect(defaultDay(tokyo, allDone, "2026-09-24", null)).toBe("2026-10-01");
  });

  test("after the trip, day 1", () => {
    expect(defaultDay(tokyo, days, "2026-10-06", null)).toBe("2026-10-01");
  });

  test("an undated trip opens on today, unless the link asks for another day", () => {
    const everydayDays = [tab("2026-09-20", "gaps"), tab("2026-09-24", "done")];
    expect(defaultDay(everyday, everydayDays, "2026-09-24", null)).toBe("2026-09-24");
    expect(defaultDay(everyday, everydayDays, "2026-09-24", "2026-09-20")).toBe("2026-09-20");
  });
});
