/** What a meal slot shows in the trip grid (#7): its state at a glance. */
export type MealSlotState =
  | { state: "empty" }
  | { state: "discussing"; proposals: number }
  | { state: "decided"; restaurant: string };
