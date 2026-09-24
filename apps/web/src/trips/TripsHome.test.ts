// See CreateTripForm.test.ts for the conventions these tests follow. In
// particular, nothing here asserts who may see or change a trip: the fake
// shows whatever it is seeded with, so such a test would prove nothing about
// the real policies (supabase/tests/database/ does that).
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { mealsApiKey } from "../grid/mealsApi.ts";
import { createFakeMealsApi } from "../test/fakeMealsApi.ts";
import { membershipApiKey } from "../invitations/membershipApi.ts";
import { createFakeMembership } from "../test/fakeMembershipApi.ts";
import { aTrip, createFakeTripsApi } from "../test/fakeTripsApi.ts";
import { buttonByText, fieldByLabel } from "../test/dom.ts";
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

async function mountHome(api: TripsApi) {
  const wrapper = mount(TripsHome, {
    global: {
      provide: {
        [tripsApiKey as symbol]: api,
        [mealsApiKey as symbol]: createFakeMealsApi(),
        // #6: the trip view also shows its members.
        [membershipApiKey as symbol]: createFakeMembership({ me: { userId: "me", name: "Me" } })
          .api,
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
