import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import MealSlotMarker from "./MealSlotMarker.vue";
import type { MealSlotState } from "./mealSlotState.ts";

function marker(slot: MealSlotState) {
  return mount(MealSlotMarker, { props: { slot } });
}

// The three states differ in colour, but colour is not allowed to be the only
// signal: each must say what it is in text a screen reader reads out.
describe("MealSlotMarker", () => {
  test("an empty meal says it is not planned", () => {
    expect(marker({ state: "empty" }).text()).toBe("Not planned");
  });

  test("a meal being discussed says so, with how many proposals", () => {
    expect(marker({ state: "discussing", proposals: 3 }).text()).toBe(
      "Being discussed: 3 proposals",
    );
    expect(marker({ state: "discussing", proposals: 1 }).text()).toBe(
      "Being discussed: 1 proposal",
    );
  });

  test("a decided meal says so, and names the restaurant", () => {
    expect(marker({ state: "decided", restaurant: "Afuri Ramen Ebisu" }).text()).toBe(
      "Decided: Afuri Ramen Ebisu",
    );
  });

  test("its icons are decoration, hidden from assistive technology", () => {
    for (const slot of [
      { state: "empty" },
      { state: "discussing", proposals: 2 },
      { state: "decided", restaurant: "Higashiya Ginza" },
    ] satisfies MealSlotState[]) {
      const icons = marker(slot).findAll("svg");
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) expect(icon.attributes("aria-hidden")).toBe("true");
    }
  });
});
