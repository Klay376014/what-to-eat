/*
 * When a meal happens (#12). Every time is on the trip's own clock: the
 * trip's timezone, never the browser's or the calendar holder's.
 *
 * Pure, and free of Vue and the browser, because the calendar Edge Function
 * (supabase/functions/calendar) imports it too: the time the meal shows is
 * the time its event is written for.
 */
import type { MealSlot } from "../grid/meal.ts";
import type { IsoDate } from "../trips/trip.ts";

/** When each slot starts unless the meal says otherwise, as "HH:MM". */
export const DEFAULT_START: Readonly<Record<MealSlot, string>> = {
  breakfast: "08:00",
  lunch: "12:00",
  dinner: "19:00",
  other: "15:00",
};

/** How long each slot's event lasts, in minutes. */
export const DURATION_MINUTES: Readonly<Record<MealSlot, number>> = {
  breakfast: 60,
  lunch: 90,
  dinner: 120,
  other: 60,
};

export interface TimedMeal {
  date: IsoDate;
  slot: MealSlot;
  /** The meal's own start time ("HH:MM", or "HH:MM:SS" from the database), or null for the slot's. */
  startTime: string | null;
}

/** The meal's start on the trip's clock, "HH:MM". */
export function mealStart(meal: Pick<TimedMeal, "slot" | "startTime">): string {
  return meal.startTime?.slice(0, 5) ?? DEFAULT_START[meal.slot];
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** What the clocks in `timeZone` read at `instant`, as if that reading were UTC. */
function wallClock(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
}

/** The zone's offset from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  return wallClock(instant, timeZone) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the clocks in `timeZone` read `time` on `date`.
 *
 * Around a DST change a reading can happen twice or not at all. Twice: the
 * first one, so nobody turns up an hour late. Not at all (the clocks skip
 * it): as late as the skipped gap, which is what a person would read off
 * their watch after putting it forward.
 */
export function zonedInstant(date: IsoDate, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  // The offsets either side of any change near this reading.
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const candidates = [wall - before, wall - after].filter(
    (instant) => wallClock(instant, timeZone) === wall,
  );
  if (candidates.length > 0) return new Date(Math.min(...candidates));
  // A skipped reading: keep the offset from before the change.
  return new Date(wall - before);
}

/** When the meal starts and ends, and its start as the trip's clock reads it. */
export function mealTimes(
  meal: TimedMeal,
  timeZone: string,
): { start: Date; end: Date; localStart: string } {
  const localStart = mealStart(meal);
  const start = zonedInstant(meal.date, localStart, timeZone);
  const end = new Date(start.getTime() + DURATION_MINUTES[meal.slot] * MINUTE);
  return { start, end, localStart };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The instant as RFC 3339 local time with that moment's offset:
 * "2026-10-03T19:00:00+09:00". Unambiguous on its own, and what the Calendar
 * API takes next to the event's timeZone.
 */
export function zonedIso(instant: Date, timeZone: string): string {
  const offset = offsetAt(instant.getTime(), timeZone) / MINUTE;
  const local = new Date(wallClock(instant.getTime(), timeZone)).toISOString().slice(0, 19);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
