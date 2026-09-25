import { describe, expect, it } from "vite-plus/test";
import {
  calendarBroken,
  calendarWaiting,
  handoverNote,
  holderLabel,
  mealSyncNote,
  type CalendarConnection,
} from "./calendarStatus.ts";

const mine: CalendarConnection = {
  holderId: "me",
  holderIsMe: true,
  holderName: "Mei",
  ready: true,
  calendarId: "cal",
  lapse: null,
  previousHolder: null,
};
const kenjis: CalendarConnection = {
  holderId: "k",
  holderIsMe: false,
  holderName: "Kenji",
  ready: true,
  calendarId: "cal",
  lapse: null,
  previousHolder: null,
};

describe("how a decided meal's calendar event stands", () => {
  it("is not synced while the trip has no calendar", () => {
    expect(mealSyncNote({ status: "pending", error: null }, null)).toEqual({
      tone: "waiting",
      text: "Not on a calendar yet: nobody has connected one for this trip.",
    });
  });

  it("is on its way once a calendar is connected", () => {
    expect(mealSyncNote({ status: "pending", error: null }, kenjis)).toEqual({
      tone: "waiting",
      text: "Not on the calendar yet: waiting to be written to Kenji's trip calendar.",
    });
  });

  it("is on the calendar once written, naming whose", () => {
    expect(mealSyncNote({ status: "synced", error: null }, kenjis)).toEqual({
      tone: "ok",
      text: "On Kenji's trip calendar, with everyone invited.",
    });
    expect(mealSyncNote({ status: "synced", error: null }, mine)).toEqual({
      tone: "ok",
      text: "On your trip calendar, with everyone invited.",
    });
  });

  it("says why a write failed", () => {
    expect(
      mealSyncNote(
        { status: "failed", error: "Couldn't write the event: Google answered 500" },
        kenjis,
      ),
    ).toEqual({
      tone: "problem",
      text: "Not on the calendar: Couldn't write the event: Google answered 500",
    });
  });
});

describe("the trip's calendar holder, as the app names them", () => {
  it("is you, their name, or a member with no name", () => {
    expect(holderLabel(mine)).toBe("your");
    expect(holderLabel(kenjis)).toBe("Kenji's");
    expect(holderLabel({ ...kenjis, holderName: null })).toBe("a member's");
  });
});

describe("what the trip's calendar is waiting for", () => {
  it("counts the meals not written yet and the ones that failed", () => {
    expect(
      calendarWaiting([
        { mealId: "a", status: "pending", error: null },
        { mealId: "b", status: "synced", error: null },
        { mealId: "c", status: "failed", error: "x" },
        { mealId: "d", status: "pending", error: null },
      ]),
    ).toEqual({ pending: 2, failed: 1 });
  });
});

describe("a decided meal on a calendar that stopped updating", () => {
  const lapsed: CalendarConnection = { ...kenjis, lapse: "revoked" };

  it("is not on it as it stands, whatever the queue says", () => {
    // Waiting may mean a change to an event already written, still showing the old details.
    const text =
      "Not on the calendar as it stands now: the trip calendar has stopped updating, so an event already there may be out of date.";
    expect(mealSyncNote({ status: "pending", error: null }, lapsed)).toEqual({
      tone: "problem",
      text,
    });
    expect(mealSyncNote({ status: "failed", error: "x" }, lapsed)).toEqual({
      tone: "problem",
      text,
    });
  });

  it("warns that an event already written will not follow later changes", () => {
    expect(mealSyncNote({ status: "synced", error: null }, lapsed)).toEqual({
      tone: "problem",
      text: "On Kenji's trip calendar, but that calendar has stopped updating: a later change won't reach it.",
    });
  });
});

describe("what the trip says when its calendar stops updating", () => {
  it("says nothing while the calendar works, or before there is one", () => {
    expect(calendarBroken(kenjis)).toBeNull();
    expect(calendarBroken(null)).toBeNull();
  });

  it("offers any member the takeover when the holder's access was revoked or expired", () => {
    expect(calendarBroken({ ...kenjis, lapse: "revoked" })).toEqual({
      headline: "The trip calendar has stopped updating",
      detail:
        "Kenji's Google Calendar access was removed, or expired after months unused, so decided meals no longer reach anyone's calendar. Anyone in the trip can take it over with their own Google account.",
      action: "Take over the calendar",
    });
  });

  it("asks the holder themselves to reconnect", () => {
    expect(calendarBroken({ ...mine, lapse: "revoked" })).toEqual({
      headline: "The trip calendar has stopped updating",
      detail:
        "Your Google Calendar access was removed, or expired after months unused, so decided meals no longer reach anyone's calendar. Connect again to carry on.",
      action: "Reconnect Google Calendar",
    });
  });

  it("says the calendar was deleted", () => {
    expect(calendarBroken({ ...kenjis, lapse: "calendar_gone" })?.detail).toBe(
      "The trip calendar was deleted from Kenji's Google account, so decided meals no longer reach anyone's calendar. Anyone in the trip can take it over with their own Google account.",
    );
    expect(calendarBroken({ ...mine, lapse: "calendar_gone" })).toMatchObject({
      detail:
        "The trip calendar was deleted from your Google account, so decided meals no longer reach anyone's calendar. Connect again to make a new one.",
      action: "Connect Google Calendar again",
    });
  });

  it("says the holder left", () => {
    expect(calendarBroken({ ...kenjis, lapse: "holder_left" })).toEqual({
      headline: "The trip calendar has stopped updating",
      detail:
        "Kenji left the trip, so decided meals no longer go on their calendar or reach anyone else's. Anyone in the trip can take it over with their own Google account.",
      action: "Take over the calendar",
    });
  });

  it("names a holder with no name as a member", () => {
    expect(calendarBroken({ ...kenjis, holderName: null, lapse: "holder_left" })?.detail).toMatch(
      /^A member left the trip/,
    );
  });
});

describe("the note left after a takeover", () => {
  const kenji = { id: "k", isMe: false, name: "Kenji" };
  const me = { id: "me", isMe: true, name: "Mei" };

  it("is nothing without a takeover", () => {
    expect(handoverNote(kenjis, "Tokyo")).toBeNull();
    expect(handoverNote(null, "Tokyo")).toBeNull();
  });

  it("tells the new holder whom to ask to delete the old calendar", () => {
    expect(handoverNote({ ...mine, previousHolder: kenji }, "Tokyo")).toEqual({
      text: "Ask Kenji to delete the old “Tokyo” calendar from their Google Calendar. Its events won't be updated any more, and until it's gone everyone sees those meals twice.",
      canDismiss: true,
    });
  });

  it("tells a holder who connected again, onto a new calendar, to delete their old one", () => {
    expect(handoverNote({ ...mine, previousHolder: me }, "Tokyo")).toEqual({
      text: "Your old “Tokyo” calendar couldn't be reached, so the app made a new one. If the old one is still in Google Calendar, perhaps on another of your Google accounts, delete it: its events won't be updated any more, and until it's gone everyone sees those meals twice.",
      canDismiss: true,
    });
  });

  it("tells the previous holder to delete it themselves", () => {
    expect(handoverNote({ ...kenjis, previousHolder: me }, "Tokyo")).toEqual({
      text: "Kenji has taken over the trip calendar. Delete your old “Tokyo” calendar from Google Calendar: its events won't be updated any more, and until it's gone everyone sees those meals twice.",
      canDismiss: true,
    });
  });

  it("explains the duplicates to everyone else", () => {
    expect(
      handoverNote({ ...kenjis, previousHolder: { id: "a", isMe: false, name: "Aiko" } }, "Tokyo"),
    ).toEqual({
      text: "Kenji took over the trip calendar from Aiko. Until Aiko deletes the old one, you may see some meals twice: go by the newer invitation.",
      canDismiss: false,
    });
  });
});
