import { describe, expect, it } from "vite-plus/test";
import {
  calendarWaiting,
  holderLabel,
  mealSyncNote,
  type CalendarConnection,
} from "./calendarStatus.ts";

const mine: CalendarConnection = {
  holderId: "me",
  holderIsMe: true,
  holderName: "Mei",
  ready: true,
};
const kenjis: CalendarConnection = {
  holderId: "k",
  holderIsMe: false,
  holderName: "Kenji",
  ready: true,
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
