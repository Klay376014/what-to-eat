/*
 * When the trip calendar's connection is dead rather than having a bad
 * moment (#13). Pure, and imported by the calendar Edge Function, which
 * records a lapse on the grant (lapse_calendar) so every member sees the
 * calendar has stopped updating, instead of each meal failing on its own.
 */
import type { LapseReason } from "./calendarStatus.ts";

/**
 * The reason the Edge Function gives a refusal to write to a calendar that
 * is not there any more: Google's own "notFound" does not say whether the
 * calendar or one event is missing, but inserting an event can only miss the
 * calendar.
 */
export const CALENDAR_GONE = "calendarGone";

/**
 * What a refusal from Google means for the connection: a lapse that only a
 * new authorisation fixes, or null for a failure worth trying again.
 */
export function lapseFrom(refusal: {
  status: number;
  reason: string | null;
  /** The OAuth token endpoint, or the Calendar API. */
  from: "token" | "calendar";
}): LapseReason | null {
  // The token endpoint's answer to a refresh token that was revoked, or that
  // expired after six months unused. Its other refusals, such as a 401
  // invalid_client for a wrong client secret, are the server's own fault and
  // say nothing about the holder's access.
  if (refusal.from === "token") return refusal.reason === "invalid_grant" ? "revoked" : null;
  // The Calendar API refusing an access token just issued: access revoked.
  if (refusal.status === 401) return "revoked";
  if (refusal.reason === CALENDAR_GONE) return "calendar_gone";
  return null;
}
