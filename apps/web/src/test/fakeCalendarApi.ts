import type { CalendarApi } from "../calendar/calendarApi.ts";
import type {
  CalendarConnection,
  LapseReason,
  MealSync,
  SyncResult,
} from "../calendar/calendarStatus.ts";

/** A working trip calendar held by someone, with whatever overrides a test needs. */
export function aConnection(overrides: Partial<CalendarConnection> = {}): CalendarConnection {
  return {
    holderId: "kenji",
    holderIsMe: false,
    holderName: "Kenji",
    ready: true,
    calendarId: "kenji-tokyo",
    lapse: null,
    previousHolder: null,
    ...overrides,
  };
}

export interface FakeCalendarApi extends CalendarApi {
  /**
   * Queues a meal, as the database does whenever its decision, time or
   * restaurant changes. Pass `decided: false` for a cleared decision.
   */
  queue(mealId: string, decided?: boolean): void;
  /** Who was sent to Google to connect, and what calendar they meant to replace, in order. */
  readonly startedConnecting: { tripId: string; replacing: string | null }[];
  /** How many times each trip's queue was asked to be written. */
  syncs(tripId: string): number;
  /** Makes the next writes fail, as Google refusing them would. */
  failWrites(message: string | null): void;
  /** Makes the next call to the Edge Function itself fail. */
  failCalls(message: string | null): void;
  /**
   * Makes the next write find the connection dead (#13), as Google refusing
   * the holder's token, or missing the calendar, would. The Edge Function
   * records it on the grant.
   */
  lapseOnNextWrite(reason: LapseReason): void;
  /**
   * Someone left the trip or was removed, as the database's trigger sees it:
   * if they held the calendar, it has stopped (#13).
   */
  memberLeft(userId: string): void;
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
 * database's trigger does. A lapsed calendar writes nothing; taking it over
 * (#13) moves it to a new calendar of mine and writes every decided meal
 * again, remembering whose calendar it replaced. It serves one trip.
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
  let connection = options.connection ? { ...options.connection } : null;
  const meals = new Map((options.meals ?? []).map((m) => [m.mealId, { ...m }]));
  const decided = new Map([...meals.keys()].map((id) => [id, true]));
  const startedConnecting: { tripId: string; replacing: string | null }[] = [];
  const syncCount = new Map<string, number>();
  let writeFailure: string | null = null;
  let callFailure: string | null = null;
  let nextLapse: LapseReason | null = null;
  let attending = options.attending ?? true;
  let settingFailure: string | null = null;
  const writes: string[] = [];
  let calendars = 0;

  function writeAll(): SyncResult {
    if (!connection?.ready) return { connected: false, written: 0, failed: 0 };
    const result = { connected: true, written: 0, failed: 0 };
    if (connection.lapse) return result;
    if (nextLapse) {
      connection = { ...connection, lapse: nextLapse };
      nextLapse = null;
      return result;
    }
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

  /** A calendar of mine replaces the trip's: every decided meal waits to go on it. */
  function takeOver(old: CalendarConnection) {
    const nothingToDelete = old.lapse === "calendar_gone";
    connection = {
      holderId: me.id,
      holderIsMe: true,
      holderName: me.name,
      ready: true,
      calendarId: `my-calendar-${++calendars}`,
      lapse: null,
      previousHolder: nothingToDelete
        ? null
        : { id: old.holderId, isMe: old.holderIsMe, name: old.holderName },
    };
    for (const mealId of meals.keys()) {
      if (decided.get(mealId)) meals.set(mealId, { mealId, status: "pending", error: null });
      else meals.delete(mealId);
    }
  }

  return {
    startedConnecting,
    async getStatus() {
      return {
        connection: connection && {
          ...connection,
          previousHolder: connection.previousHolder && { ...connection.previousHolder },
        },
        meals: [...meals.values()].map((m) => ({ ...m })),
        attending,
      };
    },
    async startConnecting(tripId, replacing) {
      startedConnecting.push({ tripId, replacing });
    },
    async connect(_tripId, returned) {
      if (callFailure) throw new Error(callFailure);
      if (!returned.code) throw new Error("No code");
      if (connection && !returned.replacing) {
        throw new Error("This trip already has a calendar connected.");
      }
      if (connection && connection.calendarId !== returned.replacing) {
        throw new Error(
          "The trip calendar changed while you were at Google. Look at it again before taking over.",
        );
      }
      if (!connection) {
        connection = {
          holderId: me.id,
          holderIsMe: true,
          holderName: me.name,
          ready: true,
          calendarId: `my-calendar-${++calendars}`,
          lapse: null,
          previousHolder: null,
        };
      } else if (connection.holderIsMe && connection.lapse !== "calendar_gone") {
        // My own calendar is still there: connecting again renews it.
        connection = { ...connection, lapse: null };
      } else {
        takeOver(connection);
      }
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
    async forgetPreviousCalendar() {
      if (callFailure) throw new Error(callFailure);
      if (connection) connection = { ...connection, previousHolder: null };
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
    lapseOnNextWrite(reason) {
      nextLapse = reason;
    },
    memberLeft(userId) {
      if (connection?.holderId === userId) connection = { ...connection, lapse: "holder_left" };
    },
  };
}
