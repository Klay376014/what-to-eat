import type { IsoDate } from "../trips/trip.ts";
import type { MealSlotState } from "../ui/mealSlotState.ts";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "other";
export type FixedSlot = Exclude<MealSlot, "other">;

/** At most one of each per day, in this order on the trail. */
export const FIXED_SLOTS: readonly FixedSlot[] = ["breakfast", "lunch", "dinner"];

/** Mirrors the label check on public.meals. */
export const MAX_MEAL_LABEL_LENGTH = 60;

const SLOT_NAMES: Record<FixedSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/** A slot of one of the trip's days that the group plans. */
export interface Meal {
  id: string;
  tripId: string;
  /** Every meal has a real date, undated trips included (ADR 0003). */
  date: IsoDate;
  slot: MealSlot;
  /** What an "other" meal is called; null for breakfast, lunch and dinner. */
  label: string | null;
  /** Its place in the day. Only "other" meals share a slot, so this orders them. */
  position: number;
  /** How many restaurants have been proposed for it. */
  proposals: number;
  /** The decided restaurant's name, or null while undecided. */
  decidedRestaurant: string | null;
}

export type NewMeal =
  | { tripId: string; date: IsoDate; slot: FixedSlot }
  | { tripId: string; date: IsoDate; slot: "other"; label: string };

/** How a meal is named: its slot, or an "other" meal's own label. */
export function mealName(meal: Pick<Meal, "slot" | "label">): string {
  return meal.slot === "other" ? (meal.label ?? "Other") : SLOT_NAMES[meal.slot];
}

export function slotName(slot: FixedSlot): string {
  return SLOT_NAMES[slot];
}

/** What the meal's slot marker shows: decided, being discussed, or not planned. */
export function mealState(meal: Meal | null): MealSlotState {
  if (meal?.decidedRestaurant) return { state: "decided", restaurant: meal.decidedRestaurant };
  if (meal && meal.proposals > 0) return { state: "discussing", proposals: meal.proposals };
  return { state: "empty" };
}

// The app's copy is English; spelled out here rather than taken from Intl,
// whose short month names differ between ICU versions ("Sep" or "Sept").
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Sat" and "3 Oct" for a trip date. A trip date is a calendar day, not an
 * instant, so it is read in UTC and no browser timezone can move it.
 */
export function formatDay(date: IsoDate): { weekday: string; date: string; full: string } {
  const instant = new Date(`${date}T00:00:00Z`);
  const weekday = WEEKDAYS[instant.getUTCDay()]!;
  const day = `${instant.getUTCDate()} ${MONTHS[instant.getUTCMonth()]!}`;
  return { weekday, date: day, full: `${weekday} ${day}` };
}

/** How a meal is listed in the date-change warning: "Dinner, Sat 3 Oct". */
export function mealContentLabel(meal: Pick<Meal, "slot" | "label" | "date">): string {
  return `${mealName(meal)}, ${formatDay(meal.date).full}`;
}

/** The problem with an "other" meal's name, or null when it can be saved. */
export function validateMealLabel(label: string): string | null {
  const name = label.trim();
  if (name.length === 0) return "Say what the meal is, like afternoon tea.";
  if (name.length > MAX_MEAL_LABEL_LENGTH) {
    return `Keep the name to ${MAX_MEAL_LABEL_LENGTH} characters or fewer.`;
  }
  return null;
}
