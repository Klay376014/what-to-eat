import type { CalendarApi } from "../calendar/calendarApi.ts";
import type { CalendarConnection, MealSync, SyncResult } from "../calendar/calendarStatus.ts";

export interface FakeCalendarApi extends CalendarApi {
  /**
   * Queues a meal, as the database does whenever its decision, time or
   * restaurant changes. Pass `decided: false` for a cleared decision.
   */
  queue(mealId: string, decided?: boolean): void;
  /** The trips someone was sent to Google to connect, in order. */
  readonly startedConnecting: string[];
  /** How many times each trip's queue was asked to be written. */
  syncs(tripId: string): number;
  /** Makes the next writes fail, as Google refusing them would. */
  failWrites(message: string | null): void;
  /** Makes the next call to the Edge Function itself fail. */
  failCalls(message: string | null): void;
  /** Whether I am a guest on the trip's events (#14). */
  attending(): boolean;
  /** Every meal whose event was written, in order, since the fake was made. */
  written(): string[];
  /** Makes the next change to my guest setting fail. */
  failSettings(message: string | null): void;
}

/**
 * An in-memory CalendarApi for component tests: a working stand-in for the
 * calendar table and Edge Function, not a record of calls. Like them, it
 * keeps a queued meal waiting until a calendar is connected, writes every
 * waiting meal when asked, and drops a cleared meal once its event is gone.
 * Changing my guest setting queues every meal with an event, as the
 * database's trigger does. It serves one trip.
 *
 * It knows nothing about who may connect or see a calendar; that is the
 * database's and the Edge Function's, tested there.
 */
export function createFakeCalendarApi(
  options: {
    me?: { id: string; name: string | null };
    connection?: CalendarConnection | null;
    meals?: MealSync[];
    /** False when I opted out of being a guest; true by default. */
    attending?: boolean;
  } = {},
): FakeCalendarApi {
  const me = options.me ?? { id: "me", name: "Mei Lin" };
  let connection = options.connection ?? null;
  const meals = new Map((options.meals ?? []).map((m) => [m.mealId, { ...m }]));
  const decided = new Map([...meals.keys()].map((id) => [id, true]));
  const startedConnecting: string[] = [];
  const syncCount = new Map<string, number>();
  let writeFailure: string | null = null;
  let callFailure: string | null = null;
  let attending = options.attending ?? true;
  let settingFailure: string | null = null;
  const writes: string[] = [];

  function writeAll(): SyncResult {
    if (!connection?.ready) return { connected: false, written: 0, failed: 0 };
    const result = { connected: true, written: 0, failed: 0 };
    for (const [mealId, sync] of meals) {
      if (sync.status === "synced") continue;
      if (writeFailure) {
        meals.set(mealId, { mealId, status: "failed", error: writeFailure });
        result.failed++;
      } else if (decided.get(mealId)) {
        meals.set(mealId, { mealId, status: "synced", error: null });
        writes.push(mealId);
        result.written++;
      } else {
        meals.delete(mealId);
        result.written++;
      }
    }
    return result;
  }

  return {
    startedConnecting,
    async getStatus() {
      return {
        connection: connection && { ...connection },
        meals: [...meals.values()].map((m) => ({ ...m })),
        attending,
      };
    },
    async startConnecting(tripId) {
      startedConnecting.push(tripId);
    },
    async connect(_tripId, returned) {
      if (callFailure) throw new Error(callFailure);
      if (!returned.code) throw new Error("No code");
      if (connection) throw new Error("This trip already has a calendar connected.");
      connection = { holderId: me.id, holderIsMe: true, holderName: me.name, ready: true };
      return writeAll();
    },
    async sync(tripId) {
      syncCount.set(tripId, (syncCount.get(tripId) ?? 0) + 1);
      if (callFailure) throw new Error(callFailure);
      return writeAll();
    },
    async setAttending(_tripId, value) {
      if (settingFailure) throw new Error(settingFailure);
      if (value === attending) return;
      attending = value;
      for (const mealId of meals.keys()) {
        meals.set(mealId, { mealId, status: "pending", error: null });
      }
    },
    attending() {
      return attending;
    },
    written() {
      return [...writes];
    },
    failSettings(message) {
      settingFailure = message;
    },
    queue(mealId, isDecided = true) {
      decided.set(mealId, isDecided);
      if (!isDecided && !meals.has(mealId)) return;
      meals.set(mealId, { mealId, status: "pending", error: null });
    },
    syncs(tripId) {
      return syncCount.get(tripId) ?? 0;
    },
    failWrites(message) {
      writeFailure = message;
    },
    failCalls(message) {
      callFailure = message;
    },
  };
}
