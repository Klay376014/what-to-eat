/*
 * The grid's day in the address, `?trip=<id>&day=YYYY-MM-DD`, so a shared
 * link or a digest email can open a given day, and coming back returns to the
 * day you left. The day belongs to the trip named beside it: a day chosen in
 * one trip is ignored by every other, so switching trips (or a reload that
 * opens on a different trip) never carries it across.
 *
 * The app has no router: this reads and replaces these two parameters and
 * leaves the rest of the address (path, other parameters, hash) alone.
 *
 * A link from an email also names a meal (`&meal=`, mealLink.ts): that one
 * opens its trip whichever the app would have opened, and the meal with it.
 */
import type { IsoDate } from "../trips/trip.ts";

const TRIP = "trip";
const DAY = "day";

/** Whether `value` is a real calendar day written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The day the address asks for in trip `tripId`, or null when it asks for
 * none, names another trip or no trip, or is not a real day.
 */
export function readDayParam(tripId: string): IsoDate | null {
  const params = new URLSearchParams(location.search);
  if (params.get(TRIP) !== tripId) return null;
  const day = params.get(DAY);
  return day !== null && isIsoDate(day) ? day : null;
}

/** Records the trip and day in the address, replacing the current history entry. */
export function writeDayParam(tripId: string, day: IsoDate): void {
  const url = new URL(location.href);
  url.searchParams.set(TRIP, tripId);
  url.searchParams.set(DAY, day);
  history.replaceState(history.state, "", url);
}
