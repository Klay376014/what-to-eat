import type { SupabaseClient } from "@supabase/supabase-js";
import { inject, type InjectionKey } from "vue";
import type { Database } from "../types/database.ts";
import type { Meal, NewMeal } from "./meal.ts";

/**
 * What the trip grid reads and writes. Like TripsApi, components reach the
 * backend only through this, so component tests fake it here.
 *
 * Whose meals come back, and who may add one, is decided by row level
 * security; that is tested in supabase/tests/database/meals_rls.test.sql.
 */
export interface MealsApi {
  /** Every meal of the trip, in date order and, within a day, in the order added. */
  listMeals(tripId: string): Promise<Meal[]>;
  /**
   * Adds a meal. Throws SlotTakenError when the day already has that
   * breakfast, lunch or dinner (someone else added it first).
   */
  addMeal(meal: NewMeal): Promise<Meal>;
  /**
   * Renames an "other" meal, sending the name trimmed. Only its label
   * changes; breakfast, lunch and dinner have no name to change.
   */
  renameMeal(mealId: string, label: string): Promise<Meal>;
  /**
   * Sets when the meal starts on the trip's clock ("HH:MM"), or null for its
   * slot's usual time. The database queues a decided meal's event to follow.
   */
  setStartTime(mealId: string, startTime: string | null): Promise<Meal>;
}

/** The database refused a second breakfast, lunch or dinner on one day. */
export class SlotTakenError extends Error {
  constructor(slot: string) {
    super(`This day already has a ${slot}.`);
    this.name = "SlotTakenError";
  }
}

export const mealsApiKey: InjectionKey<MealsApi> = Symbol("MealsApi");

export function useMealsApi(): MealsApi {
  const api = inject(mealsApiKey);
  if (!api) throw new Error("No MealsApi provided");
  return api;
}

type Client = SupabaseClient<Database>;
type MealRow = Pick<
  Database["public"]["Tables"]["meals"]["Row"],
  "id" | "trip_id" | "date" | "slot" | "label" | "position" | "start_time"
> & {
  /** PostgREST's embedded count: one row, `[{ count }]`. */
  proposals: { count: number }[];
  /** The meal's decision, one-to-one, with the decided proposal's name. */
  decisions: { proposals: { place_name: string } | null } | null;
};

/**
 * The meal, how many proposals it has (counted by the database under the
 * proposals policies, so it is the count the caller may see), and the
 * decided restaurant's name.
 */
const MEAL_COLUMNS =
  "id, trip_id, date, slot, label, position, start_time, proposals(count), decisions(proposals(place_name))";
/** Postgres unique_violation: the one-breakfast-lunch-dinner-a-day index. */
const UNIQUE_VIOLATION = "23505";

function toMeal(row: MealRow): Meal {
  return {
    id: row.id,
    tripId: row.trip_id,
    date: row.date,
    slot: row.slot,
    label: row.label,
    position: row.position,
    // Postgres sends a time as "HH:MM:SS"; the app deals in minutes.
    startTime: row.start_time?.slice(0, 5) ?? null,
    proposals: row.proposals[0]?.count ?? 0,
    decidedRestaurant: row.decisions?.proposals?.place_name ?? null,
  };
}

export function createSupabaseMealsApi(client: Client): MealsApi {
  return {
    async listMeals(tripId) {
      const { data, error } = await client
        .from("meals")
        .select(MEAL_COLUMNS)
        .eq("trip_id", tripId)
        .order("date", { ascending: true })
        .order("position", { ascending: true });
      if (error) throw error;
      return data.map(toMeal);
    },

    async addMeal(meal) {
      const { data, error } = await client
        .from("meals")
        .insert({
          trip_id: meal.tripId,
          date: meal.date,
          slot: meal.slot,
          label: meal.slot === "other" ? meal.label.trim() : null,
        })
        .select(MEAL_COLUMNS)
        .single();
      if (error?.code === UNIQUE_VIOLATION) throw new SlotTakenError(meal.slot);
      if (error) throw error;
      return toMeal(data);
    },

    async renameMeal(mealId, label) {
      // RLS turns a refused rename into zero rows rather than an error, so
      // ask for the row back to tell the two apart.
      const { data, error } = await client
        .from("meals")
        .update({ label: label.trim() })
        .eq("id", mealId)
        .select(MEAL_COLUMNS);
      if (error) throw error;
      const [row] = data;
      if (!row) throw new Error("This meal can no longer be renamed.");
      return toMeal(row);
    },

    async setStartTime(mealId, startTime) {
      const { data, error } = await client
        .from("meals")
        .update({ start_time: startTime })
        .eq("id", mealId)
        .select(MEAL_COLUMNS);
      if (error) throw error;
      const [row] = data;
      if (!row) throw new Error("This meal's time can no longer be changed.");
      return toMeal(row);
    },
  };
}
