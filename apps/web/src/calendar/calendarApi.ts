import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { inject, type InjectionKey } from "vue";
import type { Database } from "../types/database.ts";
import { consentUrl } from "./calendarConnect.ts";
import type { SyncResult, TripCalendarStatus } from "./calendarStatus.ts";

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
  /** Sends the member to Google to allow the trip calendar. Leaves the page. */
  startConnecting(tripId: string): Promise<void>;
  /**
   * Finishes connecting with Google's answer: makes the trip calendar on the
   * member's account and writes every decision waiting for one.
   */
  connect(
    tripId: string,
    returned: { code: string; codeVerifier: string; redirectUri: string },
  ): Promise<SyncResult>;
  /** Writes whatever the trip's calendar is waiting for. */
  sync(tripId: string): Promise<SyncResult>;
  /**
   * Be a guest on the trip's events, or not (#14). The database queues the
   * trip's events to be rewritten; writing them is sync()'s.
   */
  setAttending(tripId: string, attending: boolean): Promise<void>;
}

export const calendarApiKey: InjectionKey<CalendarApi> = Symbol("CalendarApi");

export function useCalendarApi(): CalendarApi {
  const api = inject(calendarApiKey);
  if (!api) throw new Error("No CalendarApi provided");
  return api;
}

type Client = SupabaseClient<Database>;

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
          .select("holder_id, calendar_id")
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
        const { data: profile, error } = await client
          .from("profiles")
          .select("display_name")
          .eq("id", grants.data.holder_id)
          .maybeSingle();
        if (error) throw error;
        connection = {
          holderId: grants.data.holder_id,
          holderIsMe: grants.data.holder_id === me,
          holderName: profile?.display_name ?? null,
          ready: grants.data.calendar_id !== null,
        };
      }
      return {
        connection,
        meals: events.data.map((e) => ({ mealId: e.meal_id, status: e.status, error: e.error })),
        attending: optOut.data === null,
      };
    },

    async startConnecting(tripId) {
      if (!config.clientId) {
        throw new Error("Calendar isn't set up for this app yet (no Google client).");
      }
      // Back to this very address, like signing in; registered with Google.
      const redirectUri = window.location.origin + window.location.pathname;
      window.location.assign(await consentUrl({ clientId: config.clientId, tripId, redirectUri }));
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
  };
}
