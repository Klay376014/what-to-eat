import { inject, ref, type InjectionKey, type Ref } from "vue";
import { errorMessage } from "../lib/errors.ts";
import type { CalendarApi } from "./calendarApi.ts";
import type { CalendarReturn } from "./calendarConnect.ts";
import type { MealSync, SyncResult, TripCalendarStatus } from "./calendarStatus.ts";

/**
 * One trip's calendar, shared by the trip's calendar card and each meal's
 * details, so a decision made in one shows its sync status in the other.
 * The trip grid makes one per trip and provides it.
 */
export interface TripCalendar {
  status: Ref<TripCalendarStatus | null>;
  loadFailure: Ref<string | null>;
  /** True while the Edge Function is connecting or writing. */
  busy: Ref<boolean>;
  /** Why the last connect or write could not be asked for, if it could not. */
  failure: Ref<string | null>;
  refresh(): Promise<void>;
  /**
   * After a change the calendar must follow (the database has queued it):
   * write it now when the trip has a working calendar, and show where it
   * stands.
   */
  followChange(): Promise<void>;
  /** Writes everything waiting, failed meals included. */
  sync(): Promise<void>;
  /**
   * Sends the member to Google to allow the trip calendar. Leaves the page.
   * With a calendar already connected, this is taking it over (#13), or its
   * holder connecting again: the calendar shown now is the one it replaces.
   */
  startConnecting(): Promise<void>;
  /** Finishes connecting with Google's answer; null when it failed. */
  connect(returned: Extract<CalendarReturn, { code: string }>): Promise<SyncResult | null>;
  mealSync(mealId: string): MealSync | null;
  /**
   * Be a guest on the trip's events, or not (#14), then rewrite the events
   * already on the calendar. False when the setting could not be changed.
   */
  setAttending(attending: boolean): Promise<boolean>;
  /**
   * After a takeover (#13), says the old calendar has been deleted, so the
   * note asking for it goes. False when that could not be saved.
   */
  forgetPreviousCalendar(): Promise<boolean>;
}

export const tripCalendarKey: InjectionKey<TripCalendar> = Symbol("TripCalendar");

/** The trip's calendar, or null outside a trip grid. */
export function useTripCalendar(): TripCalendar | null {
  return inject(tripCalendarKey, null);
}

export function createTripCalendar(api: CalendarApi, tripId: string): TripCalendar {
  const status = ref<TripCalendarStatus | null>(null);
  const loadFailure = ref<string | null>(null);
  const busy = ref(false);
  const failure = ref<string | null>(null);

  async function refresh() {
    try {
      status.value = await api.getStatus(tripId);
      loadFailure.value = null;
    } catch (error) {
      loadFailure.value = `Couldn't check the trip calendar: ${errorMessage(error)}`;
    }
  }

  // One write at a time; a change made during one is written by another after it.
  let running: Promise<void> | null = null;
  let again = false;

  async function sync(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      busy.value = true;
      try {
        do {
          again = false;
          failure.value = null;
          try {
            await api.sync(tripId);
          } catch (error) {
            failure.value = `Couldn't write to the calendar: ${errorMessage(error)}`;
          }
          await refresh();
        } while (again);
      } finally {
        busy.value = false;
        running = null;
      }
    })();
    return running;
  }

  /** A calendar being written to: connected, and not stopped (#13). */
  function working(): boolean {
    const connection = status.value?.connection;
    return Boolean(connection?.ready && !connection.lapse);
  }

  async function followChange() {
    await refresh();
    if (working()) await sync();
  }

  return {
    status,
    loadFailure,
    busy,
    failure,
    refresh,
    sync,
    followChange,
    async setAttending(attending) {
      failure.value = null;
      try {
        await api.setAttending(tripId, attending);
      } catch (error) {
        failure.value = `Couldn't change your calendar setting: ${errorMessage(error)}`;
        return false;
      }
      await followChange();
      return true;
    },
    startConnecting() {
      return api.startConnecting(tripId, status.value?.connection?.calendarId ?? null);
    },
    async forgetPreviousCalendar() {
      failure.value = null;
      try {
        await api.forgetPreviousCalendar(tripId);
      } catch (error) {
        failure.value = `Couldn't save that: ${errorMessage(error)}`;
        return false;
      }
      await refresh();
      return true;
    },
    async connect(returned) {
      busy.value = true;
      failure.value = null;
      try {
        const result = await api.connect(tripId, {
          code: returned.code,
          codeVerifier: returned.codeVerifier,
          redirectUri: returned.redirectUri,
          replacing: returned.replacing,
        });
        return result;
      } catch (error) {
        failure.value = `Couldn't connect the calendar: ${errorMessage(error)}`;
        return null;
      } finally {
        await refresh();
        busy.value = false;
      }
    },
    mealSync(mealId) {
      return status.value?.meals.find((m) => m.mealId === mealId) ?? null;
    },
  };
}
