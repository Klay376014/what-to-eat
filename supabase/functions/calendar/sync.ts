// Working a trip's calendar queue (#12): each meal claimed from
// public.calendar_events is written to, or deleted from, the trip calendar,
// and the outcome recorded against the revision claimed. See
// supabase/migrations/20260929090000_calendar.sql.

import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarEvent, eventIdFor } from "../../../apps/web/src/calendar/calendarEvent.ts";
import type { SyncResult } from "../../../apps/web/src/calendar/calendarStatus.ts";
import type { Database } from "../../../apps/web/src/types/database.ts";
import { accessToken, Calendar, type ClientCredentials } from "./google.ts";

type Admin = SupabaseClient<Database>;
type Claimed = Database["public"]["Functions"]["claim_calendar_events"]["Returns"][number];

/**
 * Between one write and the next. Every write invites the attendees, and
 * Calendar throttles invitations sent in a burst; spacing them out is
 * cheaper than meeting the 403 and backing off.
 */
const PACE_MS = 400;
/** Passes over the queue per call: later ones pick up changes made meanwhile. */
const PASSES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function claim(admin: Admin, tripId: string): Promise<Claimed[]> {
  const { data, error } = await admin.rpc("claim_calendar_events", { trip_id: tripId });
  if (error) throw error;
  return data;
}

async function finish(
  admin: Admin,
  row: Claimed,
  outcome: { eventId: string | null; calendarId: string | null; error: string | null },
): Promise<void> {
  const { error } = await admin.rpc("finish_calendar_event", {
    meal_id: row.meal_id,
    revision: row.revision,
    event_id: outcome.eventId,
    calendar_id: outcome.calendarId,
    error: outcome.error,
  });
  if (error) throw error;
}

/** Writes every meal the trip's calendar is waiting for. */
export async function syncTrip(
  admin: Admin,
  tripId: string,
  creds: ClientCredentials,
): Promise<SyncResult> {
  const { data: grant, error: grantError } = await admin
    .from("calendar_grants")
    .select("holder_id, refresh_token, calendar_id")
    .eq("trip_id", tripId)
    .maybeSingle();
  if (grantError) throw grantError;
  if (!grant?.calendar_id) return { connected: false, written: 0, failed: 0 };
  const calendarId = grant.calendar_id;

  const { data: trip, error: tripError } = await admin
    .from("trips")
    .select("name, timezone")
    .eq("id", tripId)
    .single();
  if (tripError) throw tripError;

  const result: SyncResult = { connected: true, written: 0, failed: 0 };

  let calendar: Calendar;
  try {
    calendar = new Calendar(await accessToken(grant.refresh_token, creds));
  } catch (error) {
    // Nothing can be written. Say so on every waiting meal, rather than
    // leave them looking as if they were on their way (#13 recovers).
    for (const row of await claim(admin, tripId)) {
      await finish(admin, row, { eventId: null, calendarId: null, error: message(error) });
      result.failed++;
    }
    return result;
  }

  const { data: attendees, error: attendeesError } = await admin.rpc("calendar_attendees", {
    trip_id: tripId,
  });
  if (attendeesError) throw attendeesError;

  // What failed on an earlier pass of this call, by meal and revision: not
  // retried until something changes, or the next call.
  const failedAt = new Map<string, { revision: number; error: string }>();

  for (let pass = 0; pass < PASSES; pass++) {
    const rows = await claim(admin, tripId);
    const fresh = rows.filter((row) => failedAt.get(row.meal_id)?.revision !== row.revision);
    for (const row of rows) {
      const earlier = failedAt.get(row.meal_id);
      if (earlier?.revision === row.revision) {
        await finish(admin, row, { eventId: row.event_id, calendarId, error: earlier.error });
      }
    }
    if (fresh.length === 0) break;

    for (const row of fresh) {
      try {
        if (row.place_name === null) {
          // The decision was cleared: its event goes. Deleted by the id the
          // meal fixes, not the one recorded: a write whose finish lost to
          // this very change made the event without recording it.
          await calendar.deleteEvent(calendarId, row.event_id ?? eventIdFor(row.meal_id));
          await finish(admin, row, { eventId: null, calendarId: null, error: null });
        } else {
          const event = calendarEvent({
            trip,
            meal: {
              id: row.meal_id,
              date: row.date,
              slot: row.slot,
              label: row.label,
              startTime: row.start_time,
            },
            proposal: { placeName: row.place_name, note: row.note, lat: row.lat, lng: row.lng },
            attendees,
          });
          const eventId = await calendar.putEvent(calendarId, event);
          await finish(admin, row, { eventId, calendarId, error: null });
        }
        result.written++;
      } catch (error) {
        failedAt.set(row.meal_id, { revision: row.revision, error: message(error) });
        await finish(admin, row, { eventId: row.event_id, calendarId, error: message(error) });
        result.failed++;
      }
      await sleep(PACE_MS);
    }
  }

  return result;
}
