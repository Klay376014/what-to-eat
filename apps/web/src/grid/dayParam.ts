/*
 * The grid's day in the address, `?day=YYYY-MM-DD`, so a shared link or a
 * digest email can open a given day, and coming back returns to the day you
 * left. The app has no router: this reads and replaces the one parameter and
 * leaves the rest of the address (path, other parameters, hash) alone.
 */
import type { IsoDate } from "../trips/trip.ts";

const PARAM = "day";

/** Whether `value` is a real calendar day written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The day the address asks for, or null when it asks for none (or nonsense). */
export function readDayParam(): IsoDate | null {
  const day = new URLSearchParams(location.search).get(PARAM);
  return day !== null && isIsoDate(day) ? day : null;
}

/** Records the day in the address, replacing the current history entry. */
export function writeDayParam(day: IsoDate): void {
  const url = new URL(location.href);
  url.searchParams.set(PARAM, day);
  history.replaceState(history.state, "", url);
}
