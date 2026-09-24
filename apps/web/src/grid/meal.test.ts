import { describe, expect, test } from "vite-plus/test";
import { formatDay, mealContentLabel, validateMealLabel } from "./meal.ts";

describe("formatDay", () => {
  test("names a calendar day by weekday and date, whatever the browser's timezone", () => {
    // 3 Oct 2026 is a Saturday everywhere: a trip date is a day, not an instant.
    expect(formatDay("2026-10-03")).toEqual({ weekday: "Sat", date: "3 Oct", full: "Sat 3 Oct" });
    expect(formatDay("2027-01-01").full).toBe("Fri 1 Jan");
  });
});

describe("mealContentLabel", () => {
  test("names a meal in the date-change warning by its slot or label, and its day", () => {
    expect(mealContentLabel({ slot: "dinner", label: null, date: "2026-10-03" })).toBe(
      "Dinner, Sat 3 Oct",
    );
    expect(mealContentLabel({ slot: "other", label: "Afternoon tea", date: "2026-10-04" })).toBe(
      "Afternoon tea, Sun 4 Oct",
    );
  });
});

describe("validateMealLabel", () => {
  test("accepts a name, and a name with padding the database will be sent trimmed", () => {
    expect(validateMealLabel("Afternoon tea")).toBeNull();
    expect(validateMealLabel("  Late-night snack  ")).toBeNull();
  });

  test("refuses a blank name", () => {
    expect(validateMealLabel("   ")).toBe("Say what the meal is, like afternoon tea.");
  });

  test("refuses a name longer than the database keeps", () => {
    expect(validateMealLabel("x".repeat(60))).toBeNull();
    expect(validateMealLabel("x".repeat(61))).toBe("Keep the name to 60 characters or fewer.");
  });
});
