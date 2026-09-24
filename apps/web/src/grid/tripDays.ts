/*
 * The shape of the trip grid (docs/adr/0003-trip-grid-layout.md): which days
 * get a tab, what each day's trail lists, how each tab sums its day up, and
 * which day opens first. Pure, so every rule is tested without a screen.
 */
import type { IsoDate, Trip } from "../trips/trip.ts";
import type { MealSlotState } from "../ui/mealSlotState.ts";
import { FIXED_SLOTS, mealName, mealState, slotName, type Meal, type MealSlot } from "./meal.ts";

type TripRange = Pick<Trip, "startDate" | "endDate">;

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The days that get a tab. A dated trip: every day of it, and nothing else,
 * so meals stranded by a date change do not show (the organiser was warned).
 * An undated trip: the dates that have meals, today, and any day someone
 * went to (`extra`), in date order, so none of its meals is ever hidden.
 */
export function tripDates(
  trip: TripRange,
  meals: readonly Pick<Meal, "date">[],
  today: IsoDate,
  extra: readonly IsoDate[] = [],
): IsoDate[] {
  if (trip.startDate !== null && trip.endDate !== null) {
    const days: IsoDate[] = [];
    for (let day = trip.startDate; day <= trip.endDate; day = addDays(day, 1)) days.push(day);
    return days;
  }
  return [...new Set([...meals.map((m) => m.date), today, ...extra])].sort();
}

/** One stop on a day's trail: a meal, or a breakfast, lunch or dinner not added yet. */
export interface TrailEntry {
  /** Stable across adding the meal, so the screen keeps its place. */
  key: string;
  slot: MealSlot;
  name: string;
  meal: Meal | null;
  state: MealSlotState;
}

/**
 * A day's trail: breakfast, lunch and dinner first, in that order, whether or
 * not anyone has added them yet; then the day's "other" meals in the order
 * they were added.
 */
export function dayTrail(date: IsoDate, meals: readonly Meal[]): TrailEntry[] {
  const onDay = meals.filter((m) => m.date === date);
  const fixed = FIXED_SLOTS.map((slot): TrailEntry => {
    const meal = onDay.find((m) => m.slot === slot) ?? null;
    return { key: slot, slot, name: slotName(slot), meal, state: mealState(meal) };
  });
  const others = onDay
    .filter((m) => m.slot === "other")
    .sort((a, b) => a.position - b.position)
    .map((meal): TrailEntry => ({
      key: meal.id,
      slot: "other",
      name: mealName(meal),
      meal,
      state: mealState(meal),
    }));
  return [...fixed, ...others];
}

export interface DaySummary {
  /** Meals nobody has proposed anything for yet. */
  gaps: number;
  /** Meals with proposals but no decision. */
  open: number;
  /** What the tab says: "N gap(s)", else "N open", else "Done". Text, not a colour. */
  text: string;
}

export function daySummary(trail: readonly TrailEntry[]): DaySummary {
  const gaps = trail.filter((e) => e.state.state === "empty").length;
  const open = trail.filter((e) => e.state.state === "discussing").length;
  const text =
    gaps > 0 ? `${gaps} ${gaps === 1 ? "gap" : "gaps"}` : open > 0 ? `${open} open` : "Done";
  return { gaps, open, text };
}

export interface DayTab {
  date: IsoDate;
  isToday: boolean;
  summary: DaySummary;
}

export function dayTabs(
  dates: readonly IsoDate[],
  meals: readonly Meal[],
  today: IsoDate,
): DayTab[] {
  return dates.map((date) => ({
    date,
    isToday: date === today,
    summary: daySummary(dayTrail(date, meals)),
  }));
}

/**
 * The tab the grid opens on. A day asked for in the link wins, if it is one
 * of the trip's days. Otherwise, for a dated trip: today during the trip;
 * before it, the first day with a gap, else the first still being discussed,
 * else day 1; after it, day 1. An undated trip opens on today.
 */
export function defaultDay(
  trip: TripRange,
  days: readonly DayTab[],
  today: IsoDate,
  requested: IsoDate | null,
): IsoDate {
  const has = (date: IsoDate | null) => date !== null && days.some((d) => d.date === date);
  if (has(requested)) return requested!;

  const { startDate, endDate } = trip;
  if (startDate === null || endDate === null) return today;

  const first = days[0]!.date;
  if (today >= startDate && today <= endDate && has(today)) return today;
  if (today < startDate) {
    return (
      days.find((d) => d.summary.gaps > 0)?.date ??
      days.find((d) => d.summary.open > 0)?.date ??
      first
    );
  }
  return first;
}
