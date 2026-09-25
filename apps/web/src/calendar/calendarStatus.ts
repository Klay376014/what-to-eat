/*
 * A trip's calendar as the app shows it (#12): whether one is connected and
 * whose it is, and how each decided meal's event stands. The status comes
 * from public.calendar_events, which the database keeps: a decision queues
 * its meal, the calendar Edge Function writes it.
 */

export type SyncStatus = "pending" | "synced" | "failed";

/** The trip's calendar: who connected it, on whose Google account it lives. */
export interface CalendarConnection {
  holderId: string;
  holderIsMe: boolean;
  /** Their Google name, or null when Google sent none. */
  holderName: string | null;
  /** False for the moment between connecting and Google making the calendar. */
  ready: boolean;
}

/** One meal's event: written, waiting to be, or failed and why. */
export interface MealSync {
  mealId: string;
  status: SyncStatus;
  error: string | null;
}

export interface TripCalendarStatus {
  connection: CalendarConnection | null;
  meals: MealSync[];
}

/** What a pass over the trip's calendar queue did. */
export interface SyncResult {
  /** False when the trip has no calendar yet: nothing was written. */
  connected: boolean;
  written: number;
  failed: number;
}

/** "your", "Kenji's": whose trip calendar it is. */
export function holderLabel(connection: CalendarConnection): string {
  if (connection.holderIsMe) return "your";
  return connection.holderName ? `${connection.holderName}'s` : "a member's";
}

export interface SyncNote {
  tone: "ok" | "waiting" | "problem";
  text: string;
}

/** What a decided meal says about its calendar event. */
export function mealSyncNote(
  sync: Pick<MealSync, "status" | "error">,
  connection: CalendarConnection | null,
): SyncNote {
  if (sync.status === "failed") {
    return { tone: "problem", text: `Not on the calendar: ${sync.error ?? "the write failed."}` };
  }
  if (!connection) {
    return {
      tone: "waiting",
      text: "Not on a calendar yet: nobody has connected one for this trip.",
    };
  }
  if (sync.status === "pending") {
    return {
      tone: "waiting",
      text: `Not on the calendar yet: waiting to be written to ${holderLabel(connection)} trip calendar.`,
    };
  }
  return {
    tone: "ok",
    text: `On ${holderLabel(connection)} trip calendar, with everyone invited.`,
  };
}

/** How many meals are not on the calendar yet, and how many of those failed. */
export function calendarWaiting(meals: readonly MealSync[]): {
  pending: number;
  failed: number;
} {
  return {
    pending: meals.filter((m) => m.status === "pending").length,
    failed: meals.filter((m) => m.status === "failed").length,
  };
}
