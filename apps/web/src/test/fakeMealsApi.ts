import type { Meal } from "../grid/meal.ts";
import { SlotTakenError, type MealsApi } from "../grid/mealsApi.ts";

export interface FakeMealsApi extends MealsApi {
  /**
   * Puts a meal in the backend behind the screen's back, the way another
   * member adding one would.
   */
  seed(meal: Meal): void;
}

/**
 * An in-memory MealsApi for component tests: a working stand-in for the
 * backend, not a record of calls. Like the database, it refuses a second
 * breakfast, lunch or dinner on one day and orders a day's meals by when they
 * were added.
 *
 * It knows nothing about who may see what. Access control is the database's
 * job and is tested there (supabase/tests/database/), never through this.
 */
export function createFakeMealsApi(seed: { meals?: Meal[] } = {}): FakeMealsApi {
  const meals = (seed.meals ?? []).map((meal) => ({ ...meal }));
  let nextId = 1;
  let nextPosition = Math.max(0, ...meals.map((m) => m.position)) + 1;

  return {
    async listMeals(tripId) {
      return meals
        .filter((m) => m.tripId === tripId)
        .sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)
        .map((m) => ({ ...m }));
    },
    async addMeal(input) {
      const taken = meals.some(
        (m) =>
          input.slot !== "other" &&
          m.tripId === input.tripId &&
          m.date === input.date &&
          m.slot === input.slot,
      );
      if (taken) throw new SlotTakenError(input.slot);
      const meal: Meal = {
        id: `meal-${nextId++}`,
        tripId: input.tripId,
        date: input.date,
        slot: input.slot,
        label: input.slot === "other" ? input.label.trim() : null,
        position: nextPosition++,
        proposals: 0,
        decidedRestaurant: null,
      };
      meals.push(meal);
      return { ...meal };
    },
    seed(meal) {
      meals.push({ ...meal, position: nextPosition++ });
    },
  };
}

let seededId = 1;

export function aMeal(overrides: Partial<Meal> & Pick<Meal, "tripId" | "date" | "slot">): Meal {
  const id = seededId++;
  return {
    id: `seeded-${id}`,
    label: overrides.slot === "other" ? "Snack" : null,
    position: id,
    proposals: 0,
    decidedRestaurant: null,
    ...overrides,
  };
}
