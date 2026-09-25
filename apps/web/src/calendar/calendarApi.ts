import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { inject, type InjectionKey } from "vue";
import type { Database } from "../types/database.ts";
import { consentUrl } from "./calendarConnect.ts";
import type { LapseReason, SyncResult, TripCalendarStatus } from "./calendarStatus.ts";

/**
 * A trip's calendar (#12): what the trip screen reads, and the calendar Edge
 * Function it asks to connect and to write. A separate seam from the other
 * APIs, faked the same way in component tests (src/test/fakeCalendarApi.ts).
 *
 * Who may see a trip's calendar, that no client reads a refresh token, and
 * that only the Edge Function writes are the database's rules
 * (supabase/migrations/20260929090000_calendar.sql), tested there.
 */
export interface CalendarApi {
  /**
   * Whether the trip has a calendar and whose, every queued meal's status,
   * and whether its events invite me.
   */
  getStatus(tripId: string): Promise<TripCalendarStatus>;
  /**
   * Sends the member to Google to allow the trip calendar. Leaves the page.
   * `replacing` is the calendar they mean to take over (#13), as they saw it,
   * or null to connect the trip's first.
   */
  startConnecting(tripId: string, replacing: string | null): Promise<void>;
  /**
   * Finishes connecting with Google's answer: makes the trip calendar on the
   * member's account and writes every decision waiting for one. Replacing
   * the trip's calendar is a takeover: every decided meal is written again,
   * to the new one.
   */
  connect(
    tripId: string,
    returned: { code: string; codeVerifier: string; redirectUri: string; replacing: string | null },
  ): Promise<SyncResult>;
  /** Writes whatever the trip's calendar is waiting for. */
  sync(tripId: string): Promise<SyncResult>;
  /**
   * Be a guest on the trip's events, or not (#14). The database queues the
   * trip's events to be rewritten; writing them is sync()'s.
   */
  setAttending(tripId: string, attending: boolean): Promise<void>;
  /**
   * After a takeover (#13): the old calendar has been deleted, so the note
   * asking for it goes. For the new holder and the previous one.
   */
  forgetPreviousCalendar(tripId: string): Promise<void>;
}

export const calendarApiKey: InjectionKey<CalendarApi> = Symbol("CalendarApi");

export function useCalendarApi(): CalendarApi {
  const api = inject(calendarApiKey);
  if (!api) throw new Error("No CalendarApi provided");
  return api;
}

type Client = SupabaseClient<Database>;

const LAPSE_REASONS: readonly LapseReason[] = ["revoked", "calendar_gone", "holder_left"];

/** The grant's lapse_reason, which the database constrains to these. */
function lapseReason(value: string | null): LapseReason | null {
  return LAPSE_REASONS.find((r) => r === value) ?? null;
}

/** The Edge Function's own message for a refusal, rather than "non-2xx status". */
async function functionError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as { error?: string };
      if (body.error) return new Error(body.error);
    } catch {
      // No JSON: fall back to the client's message.
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function createSupabaseCalendarApi(
  client: Client,
  config: { clientId: string | undefined },
): CalendarApi {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Not signed in");
    return data.session.user.id;
  }

  async function invoke(body: Record<string, unknown>): Promise<SyncResult> {
    const { data, error } = await client.functions.invoke<SyncResult>("calendar", { body });
    if (error) throw await functionError(error);
    return data!;
  }

  return {
    async getStatus(tripId) {
      const me = await currentUserId();
      const [grants, events, optOut] = await Promise.all([
        client
          .from("calendar_grants")
          .select("holder_id, calendar_id, lapse_reason, previous_holder_id")
          .eq("trip_id", tripId)
          .maybeSingle(),
        client.from("calendar_events").select("meal_id, status, error").eq("trip_id", tripId),
        // Only my own row is readable.
        client
          .from("calendar_opt_outs")
          .select("trip_id")
          .eq("trip_id", tripId)
          .eq("user_id", me)
          .maybeSingle(),
      ]);
      if (grants.error) throw grants.error;
      if (events.error) throw events.error;
      if (optOut.error) throw optOut.error;

      let connection: TripCalendarStatus["connection"] = null;
      if (grants.data) {
        const grant = grants.data;
        const previousId = grant.previous_holder_id;
        const ids = previousId ? [grant.holder_id, previousId] : [grant.holder_id];
        const { data: profiles, error } = await client
          .from("profiles")
          .select("id, display_name")
          .in("id", ids);
        if (error) throw error;
        const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? null;
        connection = {
          holderId: grant.holder_id,
          holderIsMe: grant.holder_id === me,
          holderName: nameOf(grant.holder_id),
          ready: grant.calendar_id !== null,
          calendarId: grant.calendar_id,
          lapse: lapseReason(grant.lapse_reason),
          previousHolder: previousId
            ? { id: previousId, isMe: previousId === me, name: nameOf(previousId) }
            : null,
        };
      }
      return {
        connection,
        meals: events.data.map((e) => ({ mealId: e.meal_id, status: e.status, error: e.error })),
        attending: optOut.data === null,
      };
    },

    async startConnecting(tripId, replacing) {
      if (!config.clientId) {
        throw new Error("Calendar isn't set up for this app yet (no Google client).");
      }
      // Back to this very address, like signing in; registered with Google.
      const redirectUri = window.location.origin + window.location.pathname;
      window.location.assign(
        await consentUrl({ clientId: config.clientId, tripId, redirectUri, replacing }),
      );
    },

    connect(tripId, returned) {
      return invoke({ action: "connect", tripId, ...returned });
    },

    sync(tripId) {
      return invoke({ action: "sync", tripId });
    },

    async setAttending(tripId, attending) {
      const { error } = attending
        ? await client.from("calendar_opt_outs").delete().eq("trip_id", tripId)
        : await client
            .from("calendar_opt_outs")
            .upsert({ trip_id: tripId }, { onConflict: "trip_id,user_id", ignoreDuplicates: true });
      if (error) throw error;
    },

    async forgetPreviousCalendar(tripId) {
      const { error } = await client.rpc("forget_previous_calendar", { trip_id: tripId });
      if (error) throw error;
    },
  };
}
