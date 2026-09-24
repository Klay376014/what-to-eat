/*
 * Mock trip for the #7 grid layout study: 5 days in Tokyo, several "Other"
 * meals on one day (Fri), and slots in all three states.
 */
import type { MealSlotState } from "../../src/ui/mealSlotState.ts";

export interface Meal {
  /** "Breakfast", "Lunch", "Dinner", or the free-text label of an "Other" meal. */
  label: string;
  kind: "breakfast" | "lunch" | "dinner" | "other";
  slot: MealSlotState;
}

export interface Day {
  date: string;
  weekday: string;
  label: string;
  meals: Meal[];
}

const empty: MealSlotState = { state: "empty" };
const discussing = (proposals: number): MealSlotState => ({ state: "discussing", proposals });
const decided = (restaurant: string): MealSlotState => ({ state: "decided", restaurant });

function day(
  date: string,
  weekday: string,
  label: string,
  [breakfast, lunch, dinner]: [MealSlotState, MealSlotState, MealSlotState],
  other: [string, MealSlotState][] = [],
): Day {
  return {
    date,
    weekday,
    label,
    meals: [
      { label: "Breakfast", kind: "breakfast", slot: breakfast },
      { label: "Lunch", kind: "lunch", slot: lunch },
      { label: "Dinner", kind: "dinner", slot: dinner },
      ...other.map(([l, slot]) => ({ label: l, kind: "other" as const, slot })),
    ],
  };
}

export const trip = { name: "Tokyo, October", dates: "14 – 18 Oct 2026", timezone: "Asia/Tokyo" };

export const days: Day[] = [
  day("2026-10-14", "Wed", "14 Oct", [empty, decided("Afuri Ramen Ebisu"), discussing(3)]),
  day(
    "2026-10-15",
    "Thu",
    "15 Oct",
    [decided("Onibus Coffee Nakameguro"), empty, decided("Uobei Shibuya Dogenzaka")],
    [["Afternoon tea", discussing(1)]],
  ),
  day(
    "2026-10-16",
    "Fri",
    "16 Oct",
    [discussing(2), decided("Tsukiji Itadori Bekkan"), empty],
    [
      ["Afternoon tea", decided("Higashiya Ginza")],
      ["Late-night snack", discussing(2)],
      ["Dessert run", empty],
    ],
  ),
  day("2026-10-17", "Sat", "17 Oct", [empty, discussing(4), discussing(1)]),
  day(
    "2026-10-18",
    "Sun",
    "18 Oct",
    [decided("Komeda Coffee Shinagawa"), empty, empty],
    [["Airport last meal", discussing(2)]],
  ),
];

export function openCount(d: Day): number {
  return d.meals.filter((m) => m.slot.state !== "decided").length;
}

export function emptyCount(d: Day): number {
  return d.meals.filter((m) => m.slot.state === "empty").length;
}

export const totals = {
  meals: days.reduce((n, d) => n + d.meals.length, 0),
  decided: days.reduce((n, d) => n + d.meals.length - openCount(d), 0),
  empty: days.reduce((n, d) => n + emptyCount(d), 0),
};

export function slotLabel(meal: Meal, d: Day): string {
  const s = meal.slot;
  const state =
    s.state === "empty"
      ? "not planned"
      : s.state === "discussing"
        ? `being discussed, ${s.proposals} ${s.proposals === 1 ? "proposal" : "proposals"}`
        : `decided, ${s.restaurant}`;
  return `${meal.label}, ${d.weekday} ${d.label}: ${state}`;
}
