/*
 * A trip's calendar as the app shows it (#12): whether one is connected and
 * whose it is, and how each decided meal's event stands. The status comes
 * from public.calendar_events, which the database keeps: a decision queues
 * its meal, the calendar Edge Function writes it.
 */

export type SyncStatus = "pending" | "synced" | "failed";

/**
 * Why the trip calendar stopped being written to (#13): the holder's Google
 * access was revoked or expired, the calendar was deleted from their
 * account, or they left the trip. Each needs someone to connect again.
 */
export type LapseReason = "revoked" | "calendar_gone" | "holder_left";

/** A member as the calendar's status names them. */
export interface CalendarPerson {
  id: string;
  isMe: boolean;
  /** Their Google name, or null when Google sent none. */
  name: string | null;
}

/** The trip's calendar: who connected it, on whose Google account it lives. */
export interface CalendarConnection {
  holderId: string;
  holderIsMe: boolean;
  /** Their Google name, or null when Google sent none. */
  holderName: string | null;
  /** False for the moment between connecting and Google making the calendar. */
  ready: boolean;
  /** The trip calendar's Google id; null while not ready. */
  calendarId: string | null;
  /** Why it stopped being written to; null while it works. */
  lapse: LapseReason | null;
  /**
   * After a takeover (#13), whose old calendar is still on their account,
   * with the trip's events on it, for them to delete; null otherwise.
   */
  previousHolder: CalendarPerson | null;
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
  /**
   * Whether the trip's events invite me (#14): true unless I opted out.
   * Being a guest shows my email address to every other guest.
   */
  attending: boolean;
}

/** What a pass over the trip's calendar queue did. */
export interface SyncResult {
  /** False when the trip has no calendar yet: nothing was written. */
  connected: boolean;
  written: number;
  failed: number;
}

/**
 * The setting that makes the trip's events invite a member, or not (#14),
 * worded the same where they join and in the trip.
 */
export const CALENDAR_GUEST_LABEL = "Add me as a guest on the trip's calendar events";

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
  if (connection?.lapse) {
    return sync.status === "synced"
      ? {
          tone: "problem",
          text: `On ${holderLabel(connection)} trip calendar, but that calendar has stopped updating: a later change won't reach it.`,
        }
      : {
          tone: "problem",
          text: "Not on the calendar as it stands now: the trip calendar has stopped updating, so an event already there may be out of date.",
        };
  }
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

/** What the trip shows, loudly, while its calendar has stopped updating. */
export interface CalendarBroken {
  headline: string;
  detail: string;
  /** The button that connects a calendar again, for whoever presses it. */
  action: string;
}

const NO_LONGER_REACHES = "so decided meals no longer reach anyone's calendar.";
const ANYONE_CAN_TAKE_OVER = "Anyone in the trip can take it over with their own Google account.";

/** Why the trip calendar stopped updating and what to do; null while it works. */
export function calendarBroken(connection: CalendarConnection | null): CalendarBroken | null {
  if (!connection?.lapse) return null;
  const headline = "The trip calendar has stopped updating";
  const mine = connection.holderIsMe;
  const whose = mine ? "Your" : holderLabel(connection).replace(/^a/, "A");
  const takeOver = "Take over the calendar";

  switch (connection.lapse) {
    case "revoked":
      return {
        headline,
        detail: `${whose} Google Calendar access was removed, or expired after months unused, ${NO_LONGER_REACHES} ${mine ? "Connect again to carry on." : ANYONE_CAN_TAKE_OVER}`,
        action: mine ? "Reconnect Google Calendar" : takeOver,
      };
    case "calendar_gone":
      return {
        headline,
        detail: `The trip calendar was deleted from ${holderLabel(connection)} Google account, ${NO_LONGER_REACHES} ${mine ? "Connect again to make a new one." : ANYONE_CAN_TAKE_OVER}`,
        action: mine ? "Connect Google Calendar again" : takeOver,
      };
    case "holder_left":
      return {
        headline,
        detail: `${connection.holderName ?? "A member"} left the trip, so decided meals no longer go on their calendar or reach anyone else's. ${ANYONE_CAN_TAKE_OVER}`,
        action: takeOver,
      };
  }
}

/** The note about the old calendar after a takeover, and whether the reader can clear it. */
export interface HandoverNote {
  text: string;
  /** The new holder and the previous one may say the old calendar is gone. */
  canDismiss: boolean;
}

/**
 * After a takeover: the old calendar is still on the previous holder's
 * account, where the app cannot reach it, with the trip's events on it. Its
 * holder is asked to delete it, and everyone else told why meals show twice.
 */
export function handoverNote(
  connection: CalendarConnection | null,
  tripName: string,
): HandoverNote | null {
  const previous = connection?.previousHolder;
  if (!connection || !previous) return null;
  const twice = "and until it's gone everyone sees those meals twice.";
  const previousName = previous.name ?? "the previous holder";
  const holderName = connection.holderName ?? "Another member";

  if (connection.holderIsMe && previous.isMe) {
    return {
      text: `Your old “${tripName}” calendar couldn't be reached, so the app made a new one. If the old one is still in Google Calendar, perhaps on another of your Google accounts, delete it: its events won't be updated any more, ${twice}`,
      canDismiss: true,
    };
  }
  if (connection.holderIsMe) {
    return {
      text: `Ask ${previousName} to delete the old “${tripName}” calendar from their Google Calendar. Its events won't be updated any more, ${twice}`,
      canDismiss: true,
    };
  }
  if (previous.isMe) {
    return {
      text: `${holderName} has taken over the trip calendar. Delete your old “${tripName}” calendar from Google Calendar: its events won't be updated any more, ${twice}`,
      canDismiss: true,
    };
  }
  return {
    text: `${holderName} took over the trip calendar from ${previousName}. Until ${previousName} deletes the old one, you may see some meals twice: go by the newer invitation.`,
    canDismiss: false,
  };
}
