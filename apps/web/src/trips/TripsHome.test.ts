// See CreateTripForm.test.ts for the conventions these tests follow. In
// particular, nothing here asserts who may see or change a trip: the fake
// shows whatever it is seeded with, so such a test would prove nothing about
// the real policies (supabase/tests/database/ does that).
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { calendarApiKey } from "../calendar/calendarApi.ts";
import {
  aConnection,
  createFakeCalendarApi,
  type FakeCalendarApi,
} from "../test/fakeCalendarApi.ts";
import { mealsApiKey } from "../grid/mealsApi.ts";
import { createFakeMealsApi } from "../test/fakeMealsApi.ts";
import { membershipApiKey, type MembershipApi } from "../invitations/membershipApi.ts";
import { createFakeMembership } from "../test/fakeMembershipApi.ts";
import { aTrip, createFakeTripsApi } from "../test/fakeTripsApi.ts";
import { buttonByText, fieldByLabel } from "../test/dom.ts";
import { captureMealLink, clearPendingMealLink, pendingMealLink } from "../grid/mealLink.ts";
import { tripsApiKey, type TripsApi } from "./tripsApi.ts";
import TripsHome from "./TripsHome.vue";

beforeEach(() => {
  vi.stubEnv("TZ", "Asia/Taipei"); // the "browser's" timezone
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T03:00:00Z")); // 3 Oct, 11:00 in Taipei
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function mountHome(
  api: TripsApi,
  more: { calendar?: FakeCalendarApi; membership?: MembershipApi } = {},
) {
  const wrapper = mount(TripsHome, {
    global: {
      provide: {
        [tripsApiKey as symbol]: api,
        [mealsApiKey as symbol]: createFakeMealsApi(),
        // #12: the grid also shows the trip's calendar.
        [calendarApiKey as symbol]: more.calendar ?? createFakeCalendarApi(),
        // #6: the trip view also shows its members.
        [membershipApiKey as symbol]:
          more.membership ?? createFakeMembership({ me: { userId: "me", name: "Me" } }).api,
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const tokyo = aTrip({
  id: "tokyo",
  name: "Tokyo",
  startDate: "2026-10-01",
  endDate: "2026-10-05",
  timezone: "Asia/Tokyo",
  organiserName: "Alice",
});
const seoul = aTrip({
  id: "seoul",
  name: "Seoul",
  startDate: "2026-12-20",
  endDate: "2026-12-24",
  timezone: "Asia/Seoul",
  organiserName: "Alice",
});

function currentTripName(wrapper: Awaited<ReturnType<typeof mountHome>>) {
  return wrapper.get("h2").text();
}

describe("with no trips", () => {
  test("shows an empty state that leads to creating a trip", async () => {
    const wrapper = await mountHome(createFakeTripsApi({ myName: "Alice" }));

    expect(wrapper.text()).toContain("No trips yet");

    await buttonByText(wrapper, "Create a trip").trigger("click");
    await fieldByLabel(wrapper, "Trip name").setValue("Tokyo");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(currentTripName(wrapper)).toBe("Tokyo");
    expect(wrapper.text()).toContain("You're the organiser");
    expect(wrapper.text()).not.toContain("No trips yet");
  });
});

describe("with several trips", () => {
  test("opens on the trip happening now", async () => {
    const wrapper = await mountHome(createFakeTripsApi({ trips: [seoul, tokyo] }));

    expect(currentTripName(wrapper)).toBe("Tokyo");
  });

  test("opens on the next trip to start when none is happening now", async () => {
    const past = aTrip({
      id: "aug",
      name: "August",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    const wrapper = await mountHome(createFakeTripsApi({ trips: [past, seoul] }));

    expect(currentTripName(wrapper)).toBe("Seoul");
  });

  test("can switch to another trip", async () => {
    const wrapper = await mountHome(createFakeTripsApi({ trips: [seoul, tokyo] }));

    await fieldByLabel(wrapper, "Trip").setValue("seoul");

    expect(currentTripName(wrapper)).toBe("Seoul");
    expect(wrapper.text()).toContain("Asia/Seoul");
  });

  test("shows who organises the trip", async () => {
    const wrapper = await mountHome(
      createFakeTripsApi({ trips: [{ ...tokyo, myRole: "member" }] }),
    );

    expect(wrapper.text()).toContain("Organised by Alice");
  });

  test("a new trip can be added alongside the others, and is opened", async () => {
    const wrapper = await mountHome(createFakeTripsApi({ trips: [tokyo] }));

    await buttonByText(wrapper, "New trip").trigger("click");
    await fieldByLabel(wrapper, "Trip name").setValue("Taichung");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(currentTripName(wrapper)).toBe("Taichung");
    const choices = fieldByLabel(wrapper, "Trip")
      .findAll("option")
      .map((o) => o.text());
    expect(choices).toEqual(["Tokyo", "Taichung"]);
  });
});

describe("following a link from an email (#15)", () => {
  // Trip ids are uuids in a real link.
  const lisbon = aTrip({
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    name: "Lisbon",
    startDate: "2026-12-20",
    endDate: "2026-12-24",
    timezone: "Europe/Lisbon",
  });
  const MEAL = "c0000000-0000-0000-0000-000000000001";

  function follow(tripId: string, day: string) {
    history.replaceState(null, "", `/?trip=${tripId}&day=${day}&meal=${MEAL}`);
    captureMealLink();
  }

  afterEach(() => {
    clearPendingMealLink();
    history.replaceState(null, "", "/");
  });

  test("opens the trip it names on the meal's day, not the trip that would open first", async () => {
    follow(lisbon.id, "2026-12-22");

    const wrapper = await mountHome(createFakeTripsApi({ trips: [tokyo, lisbon] }));

    expect(currentTripName(wrapper)).toBe("Lisbon");
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toContain("22 Dec");
  });

  test("is used once", async () => {
    follow(lisbon.id, "2026-12-22");

    await mountHome(createFakeTripsApi({ trips: [tokyo, lisbon] }));

    expect(pendingMealLink()).toBeNull();
  });

  test("a link to a trip you are not in says so, and opens as usual", async () => {
    follow(lisbon.id, "2026-12-22");

    const wrapper = await mountHome(createFakeTripsApi({ trips: [tokyo] }));

    expect(currentTripName(wrapper)).toBe("Tokyo");
    expect(wrapper.text()).toContain("The link you followed is for a trip you're not in");
  });
});

describe("editing a trip", () => {
  test("the organiser can rename it and change its dates and timezone", async () => {
    const wrapper = await mountHome(createFakeTripsApi({ trips: [tokyo] }));

    await buttonByText(wrapper, "Edit trip").trigger("click");
    await fieldByLabel(wrapper, "Trip name").setValue("Tokyo and Hakone");
    await fieldByLabel(wrapper, "End date").setValue("2026-10-07");
    await fieldByLabel(wrapper, "Timezone").setValue("Asia/Seoul");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(currentTripName(wrapper)).toBe("Tokyo and Hakone");
    expect(wrapper.text()).toContain("Asia/Seoul");
    expect(wrapper.text()).toMatch(/Oct 7, 2026|7 Oct 2026/);
  });

  const withMeals = () =>
    createFakeTripsApi({
      trips: [tokyo],
      content: {
        tokyo: [
          { id: "m1", date: "2026-10-01", label: "Lunch, Thu 1 Oct" },
          { id: "m2", date: "2026-10-03", label: "Dinner, Sat 3 Oct" },
          { id: "m3", date: "2026-10-05", label: "Breakfast, Mon 5 Oct" },
        ],
      },
    });

  async function shortenTokyo(wrapper: Awaited<ReturnType<typeof mountHome>>) {
    await buttonByText(wrapper, "Edit trip").trigger("click");
    await fieldByLabel(wrapper, "Start date").setValue("2026-10-02");
    await fieldByLabel(wrapper, "End date").setValue("2026-10-04");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
  }

  test("shortening the dates past existing meals warns with a list of them", async () => {
    const wrapper = await mountHome(withMeals());

    await shortenTokyo(wrapper);

    const warning = wrapper.get('[role="alertdialog"]');
    expect(warning.findAll("li").map((li) => li.text())).toEqual([
      "Lunch, Thu 1 Oct",
      "Breakfast, Mon 5 Oct",
    ]);
  });

  test("the warning says those meals will go missing from the grid, and what to do", async () => {
    const wrapper = await mountHome(withMeals());

    await shortenTokyo(wrapper);

    const warning = wrapper.get('[role="alertdialog"]');
    expect(warning.text()).toContain("These meals fall outside the new dates.");
    expect(warning.text()).toContain(
      "They won't appear in the trip grid until the dates include them again.",
    );
    expect(warning.text()).toContain("Check them with the group, or re-add them on the new days.");
    // The confirm button names the consequence; the safe choice has the focus.
    expect(buttonByText(wrapper, "Change dates and hide these meals").exists()).toBe(true);
    await flushPromises(); // the dialog moves focus once it has opened
    expect(document.activeElement).toBe(buttonByText(wrapper, "Keep editing").element);
  });

  test("the date change goes ahead once confirmed", async () => {
    const wrapper = await mountHome(withMeals());

    await shortenTokyo(wrapper);
    await buttonByText(wrapper, "Change dates and hide these meals").trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.text()).toMatch(/Oct 2, 2026|2 Oct 2026/);
    expect(wrapper.text()).toMatch(/Oct 4, 2026|4 Oct 2026/);
  });

  test("backing out of the warning leaves the dates as they were", async () => {
    const wrapper = await mountHome(withMeals());

    await shortenTokyo(wrapper);
    await buttonByText(wrapper, "Keep editing").trigger("click");
    await buttonByText(wrapper, "Cancel").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toMatch(/Oct 1, 2026|1 Oct 2026/);
    expect(wrapper.text()).toMatch(/Oct 5, 2026|5 Oct 2026/);
  });

  test("no warning when every meal stays inside the new dates", async () => {
    const wrapper = await mountHome(withMeals());

    await buttonByText(wrapper, "Edit trip").trigger("click");
    await fieldByLabel(wrapper, "End date").setValue("2026-10-06");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.text()).toMatch(/Oct 6, 2026|6 Oct 2026/);
  });

  test("no warning when the dates are cleared: an undated trip shows every meal", async () => {
    const wrapper = await mountHome(withMeals());

    await buttonByText(wrapper, "Edit trip").trigger("click");
    await fieldByLabel(wrapper, "Start date").setValue("");
    await fieldByLabel(wrapper, "End date").setValue("");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("No dates — for everyday use");
  });
});

describe("deleting a trip", () => {
  test("asks first, then removes the trip", async () => {
    const wrapper = await mountHome(createFakeTripsApi({ trips: [tokyo, seoul] }));

    await buttonByText(wrapper, "Edit trip").trigger("click");
    await buttonByText(wrapper, "Delete trip").trigger("click");
    expect(wrapper.get('[role="alertdialog"]').text()).toContain("Delete “Tokyo”?");

    await buttonByText(wrapper, "Delete for everyone").trigger("click");
    await flushPromises();

    expect(currentTripName(wrapper)).toBe("Seoul");
    const choices = fieldByLabel(wrapper, "Trip")
      .findAll("option")
      .map((o) => o.text());
    expect(choices).toEqual(["Seoul"]);
  });

  test("deleting the last trip returns to the empty state", async () => {
    const wrapper = await mountHome(createFakeTripsApi({ trips: [tokyo] }));

    await buttonByText(wrapper, "Edit trip").trigger("click");
    await buttonByText(wrapper, "Delete trip").trigger("click");
    await buttonByText(wrapper, "Delete for everyone").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("No trips yet");
  });
});

describe("removing the member who holds the trip calendar (#13)", () => {
  test("says at once, at the top of the trip, that the calendar has stopped updating", async () => {
    const calendar = createFakeCalendarApi({
      me: { id: "me", name: "Me" },
      connection: aConnection({ holderId: "dave", holderName: "Dave Ho" }),
    });
    const people = createFakeMembership({
      me: { userId: "me", name: "Me" },
      members: {
        tokyo: [
          { userId: "me", name: "Me", role: "organiser" },
          { userId: "dave", name: "Dave Ho", role: "member" },
        ],
      },
    });
    // The database's trigger: the holder leaving stops their calendar.
    const membership: MembershipApi = {
      ...people.api,
      async removeMember(tripId, userId) {
        await people.api.removeMember(tripId, userId);
        calendar.memberLeft(userId);
      },
    };
    const wrapper = await mountHome(
      createFakeTripsApi({ trips: [{ ...tokyo, myRole: "organiser" }] }),
      { calendar, membership },
    );
    expect(wrapper.text()).not.toContain("The trip calendar has stopped updating");

    await buttonByText(wrapper, "Remove Dave Ho").trigger("click");
    await flushPromises();
    await buttonByText(wrapper.find('[role="alertdialog"]'), "Remove").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("Dave Ho left the trip");
  });
});
