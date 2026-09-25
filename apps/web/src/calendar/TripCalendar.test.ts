// The trip's calendar card, driven through the DOM against the in-memory
// fake. Nothing here asserts who may connect or see a calendar: that is the
// database's and the Edge Function's (supabase/tests/database/calendar_*.sql).
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { buttonByText, fieldByLabel } from "../test/dom.ts";
import {
  aConnection,
  createFakeCalendarApi,
  type FakeCalendarApi,
} from "../test/fakeCalendarApi.ts";
import { aTrip } from "../test/fakeTripsApi.ts";
import { captureCalendarReturn, clearCalendarReturn, consentUrl } from "./calendarConnect.ts";
import TripCalendar from "./TripCalendar.vue";
import { createTripCalendar, tripCalendarKey } from "./useTripCalendar.ts";

const tokyo = aTrip({ id: "tokyo", name: "Tokyo in October", timezone: "Asia/Tokyo" });
const kenji = aConnection();

afterEach(() => {
  clearCalendarReturn();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

async function mountCard(api: FakeCalendarApi) {
  const wrapper = mount(TripCalendar, {
    props: { trip: tokyo },
    global: { provide: { [tripCalendarKey as symbol]: createTripCalendar(api, tokyo.id) } },
  });
  await flushPromises();
  return wrapper;
}

function hasButton(wrapper: Awaited<ReturnType<typeof mountCard>>, text: string): boolean {
  return wrapper.findAll("button").some((b) => b.text().trim() === text);
}

/** Comes back from Google's consent screen, as the address would at startup. */
async function returnFromGoogle(answer: "allowed" | "declined", replacing: string | null = null) {
  const url = new URL(
    await consentUrl({
      clientId: "c",
      tripId: tokyo.id,
      redirectUri: "http://localhost/",
      replacing,
    }),
  );
  const state = url.searchParams.get("state")!;
  history.replaceState(
    null,
    "",
    answer === "allowed" ? `/?state=${state}&code=4%2Fabc` : `/?state=${state}&error=access_denied`,
  );
  captureCalendarReturn();
}

describe("a trip with no calendar", () => {
  test("says decided meals are waiting for one, and offers connecting", async () => {
    const api = createFakeCalendarApi({
      meals: [
        { mealId: "dinner", status: "pending", error: null },
        { mealId: "lunch", status: "pending", error: null },
      ],
    });
    const wrapper = await mountCard(api);

    expect(wrapper.text()).toContain("2 decided meals aren't on a calendar yet.");
    expect(wrapper.text()).toContain("It can't see or change your other calendars.");
    await buttonByText(wrapper, "Connect Google Calendar").trigger("click");
    await flushPromises();

    expect(api.startedConnecting).toEqual([{ tripId: "tokyo", replacing: null }]);
  });

  test("does not warn about an unverified app, since Google shows none for this scope", async () => {
    const wrapper = await mountCard(createFakeCalendarApi());
    expect(wrapper.text().toLowerCase()).not.toContain("unverified");
    expect(wrapper.text().toLowerCase()).not.toContain("warning");
  });
});

describe("coming back from Google", () => {
  test("connects the calendar and writes every waiting decision at once", async () => {
    const api = createFakeCalendarApi({
      meals: [
        { mealId: "dinner", status: "pending", error: null },
        { mealId: "lunch", status: "pending", error: null },
      ],
    });
    await returnFromGoogle("allowed");

    const wrapper = await mountCard(api);

    expect(wrapper.get('[role="status"]').text()).toBe(
      "Connected. 2 decided meals are now on the calendar.",
    );
    expect(wrapper.text()).toContain(
      "Decided meals go on the “Tokyo in October” calendar on your Google account",
    );
    expect(wrapper.text()).not.toContain("aren't on a calendar yet");
  });

  test("says so when the member declined, and connects nothing", async () => {
    const api = createFakeCalendarApi();
    await returnFromGoogle("declined");

    const wrapper = await mountCard(api);

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Google Calendar wasn't connected: access was not allowed.",
    );
    expect(buttonByText(wrapper, "Connect Google Calendar").exists()).toBe(true);
  });

  test("shows why connecting failed", async () => {
    const api = createFakeCalendarApi();
    api.failCalls("This trip already has a calendar connected.");
    await returnFromGoogle("allowed");

    const wrapper = await mountCard(api);

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Couldn't connect the calendar: This trip already has a calendar connected.",
    );
  });
});

describe("a trip with a calendar", () => {
  test("says whose it is", async () => {
    const wrapper = await mountCard(createFakeCalendarApi({ connection: kenji }));
    expect(wrapper.text()).toContain(
      "Decided meals go on the “Tokyo in October” calendar on Kenji's Google account",
    );
    expect(hasButton(wrapper, "Connect Google Calendar")).toBe(false);
  });

  test("writes meals still waiting when the trip opens", async () => {
    const api = createFakeCalendarApi({
      connection: kenji,
      meals: [{ mealId: "dinner", status: "pending", error: null }],
    });

    const wrapper = await mountCard(api);

    expect(api.syncs("tokyo")).toBe(1);
    expect(wrapper.text()).not.toContain("waiting");
  });

  test("shows meals that could not be written, and tries them again", async () => {
    const api = createFakeCalendarApi({ connection: kenji });
    api.queue("dinner");
    api.failWrites("Couldn't write the event: Google answered 500");

    const wrapper = await mountCard(api);

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "1 decided meal couldn't be written to the calendar. Open it to see why.",
    );

    api.failWrites(null);
    await buttonByText(wrapper, "Try again").trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  test("says when the calendar could not be reached at all", async () => {
    const api = createFakeCalendarApi({ connection: kenji });
    api.queue("dinner");
    api.failCalls("Failed to fetch");

    const wrapper = await mountCard(api);

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Couldn't write to the calendar: Failed to fetch",
    );
    expect(wrapper.text()).toContain("1 decided meal isn't on the calendar yet.");
  });
});

describe("being a guest on the trip's events (#14)", () => {
  // Spelled out, not imported: the words are what the test checks.
  const GUEST = "Add me as a guest on the trip's calendar events";

  test("I am one unless I opted out, and the card says what that shows", async () => {
    const wrapper = await mountCard(createFakeCalendarApi({ connection: kenji }));

    expect(fieldByLabel(wrapper, GUEST).element.checked).toBe(true);
    expect(wrapper.text()).toContain("Guests can see each other's email addresses.");
  });

  test("turning it off takes me off the events already on the calendar", async () => {
    const api = createFakeCalendarApi({
      connection: kenji,
      meals: [{ mealId: "dinner", status: "synced", error: null }],
    });
    const wrapper = await mountCard(api);

    await fieldByLabel(wrapper, GUEST).setValue(false);
    await flushPromises();

    expect(api.attending()).toBe(false);
    // Rewritten through the queue, straight away.
    expect(api.written()).toEqual(["dinner"]);
    expect(fieldByLabel(wrapper, GUEST).element.checked).toBe(false);
  });

  test("I can turn it back on at any time", async () => {
    const api = createFakeCalendarApi({ connection: kenji, attending: false });
    const wrapper = await mountCard(api);

    expect(fieldByLabel(wrapper, GUEST).element.checked).toBe(false);
    await fieldByLabel(wrapper, GUEST).setValue(true);
    await flushPromises();

    expect(api.attending()).toBe(true);
    expect(fieldByLabel(wrapper, GUEST).element.checked).toBe(true);
  });

  test("can be set before the trip has a calendar", async () => {
    const api = createFakeCalendarApi();
    const wrapper = await mountCard(api);

    await fieldByLabel(wrapper, GUEST).setValue(false);
    await flushPromises();

    expect(api.attending()).toBe(false);
    expect(api.syncs("tokyo")).toBe(0);
  });

  test("says so when the change could not be saved, and shows the setting as it is", async () => {
    const api = createFakeCalendarApi({ connection: kenji });
    const wrapper = await mountCard(api);
    api.failSettings("Failed to fetch");

    await fieldByLabel(wrapper, GUEST).setValue(false);
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Couldn't change your calendar setting: Failed to fetch",
    );
    expect(fieldByLabel(wrapper, GUEST).element.checked).toBe(true);
  });
});

describe("taking over the trip's calendar (#13)", () => {
  function dialog(wrapper: Awaited<ReturnType<typeof mountCard>>) {
    return wrapper.get('[role="alertdialog"]');
  }

  test("from a calendar that works, asks first and says what it means for everyone", async () => {
    const api = createFakeCalendarApi({ connection: kenji });
    const wrapper = await mountCard(api);

    await buttonByText(wrapper, "Take over the calendar").trigger("click");
    await flushPromises();
    expect(dialog(wrapper).text()).toContain(
      "The app makes a new “Tokyo in October” calendar on your Google account and invites everyone to the decided meals again from it.",
    );
    expect(dialog(wrapper).text()).toContain(
      "Kenji's calendar stops being updated: ask them to delete it, or everyone sees each meal twice.",
    );
    expect(api.startedConnecting).toEqual([]);

    await buttonByText(wrapper, "Continue to Google").trigger("click");
    await flushPromises();
    expect(api.startedConnecting).toEqual([{ tripId: "tokyo", replacing: "kenji-tokyo" }]);
  });

  test("is not offered to the holder, whose calendar it already is", async () => {
    const wrapper = await mountCard(
      createFakeCalendarApi({ connection: aConnection({ holderId: "me", holderIsMe: true }) }),
    );
    expect(hasButton(wrapper, "Take over the calendar")).toBe(false);
  });

  test("coming back, writes every decided meal to my new calendar and says whose old one to have deleted", async () => {
    const api = createFakeCalendarApi({
      connection: aConnection({ lapse: "revoked" }),
      meals: [
        { mealId: "dinner", status: "synced", error: null },
        { mealId: "lunch", status: "pending", error: null },
      ],
    });
    await returnFromGoogle("allowed", "kenji-tokyo");

    const wrapper = await mountCard(api);

    expect(wrapper.get('[role="status"]').text()).toBe(
      "Connected. 2 decided meals are now on the calendar.",
    );
    expect(api.written()).toEqual(["dinner", "lunch"]);
    expect(wrapper.text()).toContain(
      "Decided meals go on the “Tokyo in October” calendar on your Google account",
    );
    expect(wrapper.text()).toContain(
      "Ask Kenji to delete the old “Tokyo in October” calendar from their Google Calendar.",
    );
  });

  test("the note about the old calendar goes once it is deleted", async () => {
    const api = createFakeCalendarApi({
      connection: aConnection({
        holderId: "me",
        holderIsMe: true,
        holderName: "Mei Lin",
        previousHolder: { id: "kenji", isMe: false, name: "Kenji" },
      }),
    });
    const wrapper = await mountCard(api);
    expect(wrapper.text()).toContain("Ask Kenji to delete the old");

    await buttonByText(wrapper, "It's deleted").trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Ask Kenji to delete the old");
  });

  test("the previous holder is asked to delete their old calendar", async () => {
    const wrapper = await mountCard(
      createFakeCalendarApi({
        connection: aConnection({ previousHolder: { id: "me", isMe: true, name: "Mei Lin" } }),
      }),
    );
    expect(wrapper.text()).toContain(
      "Kenji has taken over the trip calendar. Delete your old “Tokyo in October” calendar from Google Calendar",
    );
    expect(buttonByText(wrapper, "It's deleted").exists()).toBe(true);
  });

  test("everyone else is told why meals may show twice", async () => {
    const wrapper = await mountCard(
      createFakeCalendarApi({
        connection: aConnection({ previousHolder: { id: "aiko", isMe: false, name: "Aiko" } }),
      }),
    );
    expect(wrapper.text()).toContain("Kenji took over the trip calendar from Aiko.");
    expect(hasButton(wrapper, "It's deleted")).toBe(false);
  });

  test("says so when someone else took it over while I was at Google", async () => {
    const api = createFakeCalendarApi({ connection: aConnection({ calendarId: "aiko-tokyo" }) });
    await returnFromGoogle("allowed", "kenji-tokyo");

    const wrapper = await mountCard(api);

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Couldn't connect the calendar: The trip calendar changed while you were at Google. Look at it again before taking over.",
    );
  });
});

describe("a trip calendar that stopped updating (#13)", () => {
  test("does not say its meals are on their way, nor offer to retry them", async () => {
    const api = createFakeCalendarApi({
      connection: aConnection({ lapse: "revoked" }),
      meals: [{ mealId: "dinner", status: "failed", error: "x" }],
    });
    const wrapper = await mountCard(api);

    expect(wrapper.text()).toContain(
      "Decided meals aren't reaching this calendar any more: it has stopped updating.",
    );
    expect(wrapper.text()).not.toContain("couldn't be written");
    expect(hasButton(wrapper, "Try again")).toBe(false);
    expect(api.syncs("tokyo")).toBe(0);
  });
});
