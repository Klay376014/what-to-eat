// The trip's calendar card, driven through the DOM against the in-memory
// fake. Nothing here asserts who may connect or see a calendar: that is the
// database's and the Edge Function's (supabase/tests/database/calendar_*.sql).
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { buttonByText } from "../test/dom.ts";
import { createFakeCalendarApi, type FakeCalendarApi } from "../test/fakeCalendarApi.ts";
import { aTrip } from "../test/fakeTripsApi.ts";
import { captureCalendarReturn, clearCalendarReturn, consentUrl } from "./calendarConnect.ts";
import TripCalendar from "./TripCalendar.vue";
import { createTripCalendar, tripCalendarKey } from "./useTripCalendar.ts";

const tokyo = aTrip({ id: "tokyo", name: "Tokyo in October", timezone: "Asia/Tokyo" });
const kenji = { holderId: "kenji", holderIsMe: false, holderName: "Kenji", ready: true };

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

/** Comes back from Google's consent screen, as the address would at startup. */
async function returnFromGoogle(answer: "allowed" | "declined") {
  const url = new URL(
    await consentUrl({ clientId: "c", tripId: tokyo.id, redirectUri: "http://localhost/" }),
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

    expect(api.startedConnecting).toEqual(["tokyo"]);
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
    expect(wrapper.find("button").exists()).toBe(false);
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
