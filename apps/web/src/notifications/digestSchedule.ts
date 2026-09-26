/*
 * When a trip's daily digest goes out (#15): 08:00 on the trip's own clock,
 * the morning of the place the group is in. Never the recipient's zone, the
 * browser's, or UTC's: a Tokyo trip's 08:00 is 23:00 UTC the day before.
 *
 * Pure, and imported by the notify Edge Function, which runs every quarter
 * hour and sends each trip the digest this says is due, once per local day.
 */
import { zonedInstant } from "../calendar/mealTime.ts";
import { dateIn, type IsoDate } from "../trips/trip.ts";

/** The time of day, on the trip's clock, that its digest goes out. */
export const DIGEST_TIME = "08:00";

/**
 * The local day whose digest is due at `now` for a trip in `timeZone`, or
 * null before 08:00 there. It stays due until that day ends, so a run that
 * comes late (the scheduler missed a beat) still sends it; a digest is never
 * sent for a day that has already ended.
 */
export function digestDue(timeZone: string, now: Date): IsoDate | null {
  const today = dateIn(timeZone, now);
  return now.getTime() >= zonedInstant(today, DIGEST_TIME, timeZone).getTime() ? today : null;
}

/**
 * The day whose digest a trip should be sent now, or null: 08:00 has passed
 * on its clock, it has not had that day's digest (`lastDay`, the day of the
 * last one it had), and the trip has not ended. A trip with no dates is for
 * everyday use and never ends.
 */
export function dueDigestDay(
  trip: { timezone: string; endDate: IsoDate | null },
  lastDay: IsoDate | null,
  now: Date,
): IsoDate | null {
  const day = digestDue(trip.timezone, now);
  if (day === null) return null;
  if (lastDay !== null && lastDay >= day) return null;
  if (trip.endDate !== null && trip.endDate < day) return null;
  return day;
}
