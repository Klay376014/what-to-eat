/*
 * A link straight to a meal, as every email has (#15):
 * `?trip=<id>&day=YYYY-MM-DD&meal=<id>` (notifications/emails.ts builds it).
 * The app opens that trip, on that day, with that meal's details open.
 *
 * Someone following it may have to sign in first, and sign-in comes back to
 * the app's bare address (auth.ts), so, like an invitation
 * (invitations/pendingInvite.ts), the link is copied into sessionStorage at
 * startup and used once. The meal is taken out of the address bar then,
 * so a reload later does not reopen it; the trip and day stay, as the grid
 * keeps them there itself (dayParam.ts).
 */
import type { IsoDate } from "../trips/trip.ts";
import { isIsoDate } from "./dayParam.ts";

export interface MealLink {
  tripId: string;
  day: IsoDate;
  mealId: string;
}

const KEY = "what-to-eat:pending-meal";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let held: MealLink | null = null;

/** The meal a query string links to, or null when it links to none. */
export function readMealLink(search: string): MealLink | null {
  const params = new URLSearchParams(search);
  const tripId = params.get("trip");
  const day = params.get("day");
  const mealId = params.get("meal");
  if (!tripId || !UUID.test(tripId) || !mealId || !UUID.test(mealId)) return null;
  if (day === null || !isIsoDate(day)) return null;
  return { tripId, day, mealId };
}

function storage(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads a meal link from the address, keeps it, and takes the meal out of the bar. */
export function captureMealLink(win: Window = window): void {
  const link = readMealLink(win.location.search);
  if (link === null) return;

  held = link;
  try {
    storage(win)?.setItem(KEY, JSON.stringify(link));
  } catch {
    // Full or blocked storage: the in-memory copy still covers this page.
  }
  const url = new URL(win.location.href);
  url.searchParams.delete("meal");
  win.history.replaceState(win.history.state, "", url);
}

/** The meal link waiting to be opened, if any. */
export function pendingMealLink(win: Window = window): MealLink | null {
  if (held !== null) return held;
  try {
    const stored = storage(win)?.getItem(KEY);
    if (!stored) return null;
    const link = JSON.parse(stored) as Partial<MealLink>;
    return readMealLink(
      new URLSearchParams({
        trip: String(link.tripId),
        day: String(link.day),
        meal: String(link.mealId),
      }).toString(),
    );
  } catch {
    return null;
  }
}

/** Forgets the meal link, once it has been opened. */
export function clearPendingMealLink(win: Window = window): void {
  held = null;
  try {
    storage(win)?.removeItem(KEY);
  } catch {
    // Nothing stored, then.
  }
}
