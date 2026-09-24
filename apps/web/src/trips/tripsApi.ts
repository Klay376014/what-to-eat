import type { SupabaseClient } from "@supabase/supabase-js";
import { inject, type InjectionKey } from "vue";
import { mealContentLabel } from "../grid/meal.ts";
import type { Database } from "../types/database.ts";
import type { DatedContent, Trip, TripSettings } from "./trip.ts";

/**
 * Everything the trip screens read and write. Components reach the backend
 * only through this, so component tests fake it here rather than at HTTP.
 *
 * Which trips come back is decided by row level security in the database,
 * not by filtering here; that is tested in supabase/tests/database/.
 */
export interface TripsApi {
  /** Every trip the signed-in user currently belongs to. */
  listTrips(): Promise<Trip[]>;
  /** Creates the trip with the signed-in user as its organiser. */
  createTrip(settings: TripSettings): Promise<Trip>;
  updateTrip(id: string, settings: TripSettings): Promise<Trip>;
  deleteTrip(id: string): Promise<void>;
  /** The trip's content that belongs to a particular day, such as meals. */
  listDatedContent(tripId: string): Promise<DatedContent[]>;
}

export const tripsApiKey: InjectionKey<TripsApi> = Symbol("TripsApi");

export function useTripsApi(): TripsApi {
  const api = inject(tripsApiKey);
  if (!api) throw new Error("No TripsApi provided");
  return api;
}

type Client = SupabaseClient<Database>;
type TripRow = Database["public"]["Tables"]["trips"]["Row"];

const TRIP_COLUMNS = "id, name, start_date, end_date, timezone, created_at";

export function createSupabaseTripsApi(client: Client): TripsApi {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Not signed in");
    return data.session.user.id;
  }

  /** Adds the caller's role and the organiser's name to trip rows. */
  async function withMembership(rows: TripRow[]): Promise<Trip[]> {
    if (rows.length === 0) return [];
    const me = await currentUserId();
    const tripIds = rows.map((row) => row.id);

    const { data: members, error } = await client
      .from("trip_members")
      .select("trip_id, user_id, role")
      .in("trip_id", tripIds)
      .is("left_at", null);
    if (error) throw error;

    const organiserIds = [
      ...new Set(members.filter((m) => m.role === "organiser").map((m) => m.user_id)),
    ];
    const { data: profiles, error: profileError } = await client
      .from("profiles")
      .select("id, display_name")
      .in("id", organiserIds);
    if (profileError) throw profileError;
    const nameOf = new Map(profiles.map((p) => [p.id, p.display_name]));

    return rows.map((row) => {
      const mine = members.find((m) => m.trip_id === row.id && m.user_id === me);
      const organiser = members.find((m) => m.trip_id === row.id && m.role === "organiser");
      return {
        id: row.id,
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        timezone: row.timezone,
        myRole: mine?.role ?? "member",
        organiserName: organiser ? (nameOf.get(organiser.user_id) ?? null) : null,
      };
    });
  }

  return {
    async listTrips() {
      const { data, error } = await client
        .from("trips")
        .select(TRIP_COLUMNS)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return withMembership(data);
    },

    async createTrip(settings) {
      const { data, error } = await client
        .rpc("create_trip", {
          name: settings.name.trim(),
          timezone: settings.timezone,
          ...(settings.startDate && settings.endDate
            ? { start_date: settings.startDate, end_date: settings.endDate }
            : {}),
        })
        .single();
      if (error) throw error;
      const [trip] = await withMembership([data]);
      return trip!;
    },

    async updateTrip(id, settings) {
      const { data, error } = await client
        .from("trips")
        .update({
          name: settings.name.trim(),
          start_date: settings.startDate,
          end_date: settings.endDate,
          timezone: settings.timezone,
        })
        .eq("id", id)
        .select(TRIP_COLUMNS)
        .single();
      if (error) throw error;
      const [trip] = await withMembership([data]);
      return trip!;
    },

    async deleteTrip(id) {
      // RLS turns a refused delete into zero rows rather than an error, so
      // ask for the deleted row back to tell the two apart.
      const { data, error } = await client.from("trips").delete().eq("id", id).select("id");
      if (error) throw error;
      if (data.length === 0) throw new Error("Only the organiser can delete this trip.");
    },

    async listDatedContent(tripId) {
      // Every meal, so the date-change warning lists each one that would
      // fall outside the new range (#5, #7).
      const { data, error } = await client
        .from("meals")
        .select("id, date, slot, label")
        .eq("trip_id", tripId)
        .order("date", { ascending: true })
        .order("position", { ascending: true });
      if (error) throw error;
      return data.map((meal) => ({ id: meal.id, date: meal.date, label: mealContentLabel(meal) }));
    },
  };
}
