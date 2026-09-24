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
  "id" | "trip_id" | "date" | "slot" | "label" | "position"
>;

const MEAL_COLUMNS = "id, trip_id, date, slot, label, position";
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
    // TODO(#8): count the meal's proposals once they exist.
    proposals: 0,
    // TODO(#9): the decided restaurant's name once decisions exist.
    decidedRestaurant: null,
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
  };
}
