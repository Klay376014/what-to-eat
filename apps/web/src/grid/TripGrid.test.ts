// The trip grid, driven through the DOM against the in-memory fake. As in
// TripsHome.test.ts, nothing here asserts who may see or add a meal: the fake
// shows whatever it is seeded with, so such a test would prove nothing about
// the real policies (supabase/tests/database/meals_rls.test.sql does that).
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { aMeal, createFakeMealsApi, type FakeMealsApi } from "../test/fakeMealsApi.ts";
import { aTrip } from "../test/fakeTripsApi.ts";
import { buttonByText, fieldByLabel } from "../test/dom.ts";
import type { Trip } from "../trips/trip.ts";
import { mealsApiKey } from "./mealsApi.ts";
import TripGrid from "./TripGrid.vue";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 24 Sep 2026, 11:00 in Tokyo: a week before the Tokyo trip.
  vi.setSystemTime(new Date("2026-09-24T02:00:00Z"));
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

const tokyo = aTrip({
  id: "tokyo",
  name: "Tokyo",
  startDate: "2026-10-01",
  endDate: "2026-10-05",
  timezone: "Asia/Tokyo",
});
const everyday = aTrip({ id: "home", name: "Everyday", timezone: "Asia/Taipei" });

async function mountGrid(trip: Trip, api: FakeMealsApi = createFakeMealsApi()) {
  const wrapper = mount(TripGrid, {
    props: { trip },
    global: { provide: { [mealsApiKey as symbol]: api } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

type Wrapper = VueWrapper;

function tabs(wrapper: Wrapper) {
  return wrapper.findAll<HTMLButtonElement>('[role="tab"]');
}

function tabTexts(wrapper: Wrapper) {
  return tabs(wrapper).map((t) => t.text().replace(/\s+/g, " ").trim());
}

function selectedTab(wrapper: Wrapper) {
  const selected = tabs(wrapper).filter((t) => t.attributes("aria-selected") === "true");
  expect(selected).toHaveLength(1);
  return selected[0]!;
}

function tabFor(wrapper: Wrapper, date: string) {
  const tab = tabs(wrapper).find((t) => t.text().includes(date));
  if (!tab) throw new Error(`No tab for ${date}`);
  return tab;
}

function panel(wrapper: Wrapper) {
  return wrapper.get('[role="tabpanel"]');
}

/** The trail's meals as a person reads them: each slot's button text. */
function trail(wrapper: Wrapper) {
  return panel(wrapper)
    .findAll("[aria-expanded]")
    .map((b) => b.text().replace(/\s+/g, " ").trim());
}

function slotButton(wrapper: Wrapper, name: string): DOMWrapper<HTMLButtonElement> {
  const button = panel(wrapper)
    .findAll<HTMLButtonElement>("[aria-expanded]")
    .find((b) => b.text().trim().startsWith(name));
  if (!button) throw new Error(`No slot "${name}"`);
  return button;
}

describe("a dated trip", () => {
  test("has a tab for every day, each with its weekday, date and gap summary", async () => {
    const wrapper = await mountGrid(tokyo);

    expect(tabTexts(wrapper)).toEqual([
      "Thu 1 Oct 3 gaps",
      "Fri 2 Oct 3 gaps",
      "Sat 3 Oct 3 gaps",
      "Sun 4 Oct 3 gaps",
      "Mon 5 Oct 3 gaps",
    ]);
  });

  test("sums each day up in words: gaps, else meals still open, else done", async () => {
    const api = createFakeMealsApi({
      meals: [
        ...["breakfast", "lunch", "dinner"].map((slot) =>
          aMeal({
            tripId: "tokyo",
            date: "2026-10-01",
            slot: slot as "breakfast",
            decidedRestaurant: "Somewhere",
          }),
        ),
        aMeal({
          tripId: "tokyo",
          date: "2026-10-02",
          slot: "breakfast",
          decidedRestaurant: "Cafe",
        }),
        aMeal({ tripId: "tokyo", date: "2026-10-02", slot: "lunch", proposals: 2 }),
        aMeal({ tripId: "tokyo", date: "2026-10-02", slot: "dinner", proposals: 1 }),
        aMeal({ tripId: "tokyo", date: "2026-10-03", slot: "lunch", proposals: 1 }),
      ],
    });
    const wrapper = await mountGrid(tokyo, api);

    expect(tabTexts(wrapper).slice(0, 3)).toEqual([
      "Thu 1 Oct Done",
      "Fri 2 Oct 2 open",
      "Sat 3 Oct 2 gaps",
    ]);
  });

  test("lists breakfast, lunch and dinner on an empty day, none of them planned", async () => {
    const wrapper = await mountGrid(tokyo);

    expect(trail(wrapper)).toEqual([
      "Breakfast Not planned",
      "Lunch Not planned",
      "Dinner Not planned",
    ]);
  });

  test("shows each meal's state: not planned, how many proposals, or the decided restaurant", async () => {
    const api = createFakeMealsApi({
      meals: [
        aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "lunch", proposals: 3 }),
        aMeal({
          tripId: "tokyo",
          date: "2026-10-01",
          slot: "dinner",
          proposals: 2,
          decidedRestaurant: "Afuri Ramen Ebisu",
        }),
      ],
    });
    const wrapper = await mountGrid(tokyo, api);

    expect(trail(wrapper)).toEqual([
      "Breakfast Not planned",
      "Lunch Being discussed: 3 proposals",
      "Dinner Decided: Afuri Ramen Ebisu",
    ]);
  });

  test("lists the day's other meals after dinner, each with its own name, in the order added", async () => {
    const api = createFakeMealsApi({
      meals: [
        aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "other", label: "Late-night ramen" }),
        aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "dinner", proposals: 1 }),
        aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "other", label: "Airport last meal" }),
      ],
    });
    const wrapper = await mountGrid(tokyo, api);

    expect(trail(wrapper)).toEqual([
      "Breakfast Not planned",
      "Lunch Not planned",
      "Dinner Being discussed: 1 proposal",
      "Late-night ramen Not planned",
      "Airport last meal Not planned",
    ]);
  });
});

describe("the day tabs", () => {
  test("are a tablist whose tabs control the day's trail", async () => {
    const wrapper = await mountGrid(tokyo);

    const list = wrapper.get('[role="tablist"]');
    expect(list.attributes("aria-label")).toBe("Days");
    expect(tabs(wrapper)).toHaveLength(5);

    const selected = selectedTab(wrapper);
    expect(panel(wrapper).attributes("aria-labelledby")).toBe(selected.attributes("id"));
    for (const tab of tabs(wrapper)) {
      expect(tab.attributes("aria-controls")).toBe(panel(wrapper).attributes("id"));
    }
  });

  test("are one tab stop: only the selected day can be tabbed to", async () => {
    const wrapper = await mountGrid(tokyo);

    for (const tab of tabs(wrapper)) {
      const selected = tab.attributes("aria-selected") === "true";
      expect(tab.attributes("tabindex")).toBe(selected ? "0" : "-1");
    }
  });

  test("clicking a day shows that day's trail", async () => {
    const api = createFakeMealsApi({
      meals: [aMeal({ tripId: "tokyo", date: "2026-10-04", slot: "other", label: "Tea" })],
    });
    const wrapper = await mountGrid(tokyo, api);

    await tabFor(wrapper, "4 Oct").trigger("click");

    expect(selectedTab(wrapper).text()).toContain("4 Oct");
    expect(trail(wrapper)).toContain("Tea Not planned");
  });

  test("the right and left arrow keys move between days, taking the focus along", async () => {
    history.replaceState(null, "", "/?day=2026-10-02");
    const wrapper = await mountGrid(tokyo);
    selectedTab(wrapper).element.focus();

    await selectedTab(wrapper).trigger("keydown", { key: "ArrowRight" });
    expect(selectedTab(wrapper).text()).toContain("3 Oct");
    expect(document.activeElement).toBe(selectedTab(wrapper).element);

    await selectedTab(wrapper).trigger("keydown", { key: "ArrowLeft" });
    await selectedTab(wrapper).trigger("keydown", { key: "ArrowLeft" });
    expect(selectedTab(wrapper).text()).toContain("1 Oct");
    expect(document.activeElement).toBe(selectedTab(wrapper).element);
  });

  test("the arrow keys wrap around at either end, and Home and End jump there", async () => {
    history.replaceState(null, "", "/?day=2026-10-01");
    const wrapper = await mountGrid(tokyo);

    await selectedTab(wrapper).trigger("keydown", { key: "ArrowLeft" });
    expect(selectedTab(wrapper).text()).toContain("5 Oct");
    await selectedTab(wrapper).trigger("keydown", { key: "ArrowRight" });
    expect(selectedTab(wrapper).text()).toContain("1 Oct");
    await selectedTab(wrapper).trigger("keydown", { key: "End" });
    expect(selectedTab(wrapper).text()).toContain("5 Oct");
    await selectedTab(wrapper).trigger("keydown", { key: "Home" });
    expect(selectedTab(wrapper).text()).toContain("1 Oct");
  });

  test("a trip longer than a week still gets a tab for every day", async () => {
    const long = { ...tokyo, endDate: "2026-10-14" };
    const wrapper = await mountGrid(long);

    expect(tabs(wrapper)).toHaveLength(14);
  });
});

describe("which day opens", () => {
  test("a day in the link opens first", async () => {
    history.replaceState(null, "", "/?day=2026-10-04");
    const wrapper = await mountGrid(tokyo);

    expect(selectedTab(wrapper).text()).toContain("4 Oct");
  });

  test("before the trip, the first day with a gap", async () => {
    const decided = (date: string) =>
      (["breakfast", "lunch", "dinner"] as const).map((slot) =>
        aMeal({ tripId: "tokyo", date, slot, decidedRestaurant: "Somewhere" }),
      );
    const api = createFakeMealsApi({ meals: [...decided("2026-10-01"), ...decided("2026-10-02")] });
    const wrapper = await mountGrid(tokyo, api);

    expect(selectedTab(wrapper).text()).toContain("3 Oct");
  });

  test("during the trip, today on the trip's own calendar", async () => {
    // 2 Oct, 23:30 in Taipei, is already 3 Oct in Tokyo.
    vi.setSystemTime(new Date("2026-10-02T15:30:00Z"));
    const wrapper = await mountGrid(tokyo);

    expect(selectedTab(wrapper).text()).toContain("Today");
    expect(selectedTab(wrapper).text()).toContain("3 Oct");
  });

  test("choosing a day puts it in the address, so coming back returns to it", async () => {
    const wrapper = await mountGrid(tokyo);

    await tabFor(wrapper, "5 Oct").trigger("click");
    expect(new URLSearchParams(location.search).get("day")).toBe("2026-10-05");

    wrapper.unmount();
    const again = await mountGrid(tokyo);
    expect(selectedTab(again).text()).toContain("5 Oct");
  });
});

describe("adding meals", () => {
  test("a breakfast, lunch or dinner not planned yet can be added", async () => {
    const api = createFakeMealsApi();
    const wrapper = await mountGrid(tokyo, api);

    await slotButton(wrapper, "Lunch").trigger("click");
    expect(slotButton(wrapper, "Lunch").attributes("aria-expanded")).toBe("true");
    await buttonByText(wrapper, "Start planning lunch").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Lunch is open for proposals.");
    expect((await api.listMeals("tokyo")).map((m) => [m.date, m.slot])).toEqual([
      ["2026-10-01", "lunch"],
    ]);
  });

  test("a lunch that is already there is shown, not offered again", async () => {
    const api = createFakeMealsApi({
      meals: [aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "lunch" })],
    });
    const wrapper = await mountGrid(tokyo, api);

    await slotButton(wrapper, "Lunch").trigger("click");

    expect(wrapper.text()).toContain("Lunch is open for proposals.");
    expect(wrapper.text()).not.toContain("Start planning lunch");
  });

  test("a second lunch is refused, and the one someone else added first is shown", async () => {
    const api = createFakeMealsApi();
    const wrapper = await mountGrid(tokyo, api);
    await slotButton(wrapper, "Lunch").trigger("click");

    // Another member adds lunch while this screen still shows none.
    api.seed(aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "lunch", proposals: 2 }));
    await buttonByText(wrapper, "Start planning lunch").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Someone else added lunch first");
    expect(trail(wrapper)).toContain("Lunch Being discussed: 2 proposals");
    expect((await api.listMeals("tokyo")).filter((m) => m.slot === "lunch")).toHaveLength(1);
  });

  test("several other meals can be added to one day, and they keep their order", async () => {
    const api = createFakeMealsApi();
    const wrapper = await mountGrid(tokyo, api);

    for (const name of ["Afternoon tea", "Late-night snack", "Afternoon tea"]) {
      await buttonByText(wrapper, "Add another meal").trigger("click");
      await fieldByLabel(wrapper, "What's the meal?").setValue(name);
      await wrapper.get("form").trigger("submit");
      await flushPromises();
    }

    expect(trail(wrapper).slice(3)).toEqual([
      "Afternoon tea Not planned",
      "Late-night snack Not planned",
      "Afternoon tea Not planned",
    ]);

    wrapper.unmount();
    const again = await mountGrid(tokyo, api);
    expect(trail(again).slice(3)).toEqual([
      "Afternoon tea Not planned",
      "Late-night snack Not planned",
      "Afternoon tea Not planned",
    ]);
  });

  test("an other meal needs a name", async () => {
    const api = createFakeMealsApi();
    const wrapper = await mountGrid(tokyo, api);

    await buttonByText(wrapper, "Add another meal").trigger("click");
    await fieldByLabel(wrapper, "What's the meal?").setValue("   ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Say what the meal is, like afternoon tea.");
    expect(await api.listMeals("tokyo")).toEqual([]);
  });

  test("adding an other meal can be cancelled", async () => {
    const wrapper = await mountGrid(tokyo);

    await buttonByText(wrapper, "Add another meal").trigger("click");
    await buttonByText(wrapper, "Cancel").trigger("click");

    expect(wrapper.find("form").exists()).toBe(false);
    expect(trail(wrapper)).toHaveLength(3);
  });
});

describe("an undated trip", () => {
  test("has a tab for each date with meals, plus today, labelled Today, and opens on today", async () => {
    // 24 Sep 2026 in Taipei.
    const api = createFakeMealsApi({
      meals: [
        aMeal({ tripId: "home", date: "2026-09-20", slot: "dinner", decidedRestaurant: "Din Tai" }),
        aMeal({ tripId: "home", date: "2026-09-26", slot: "other", label: "Brunch" }),
      ],
    });
    const wrapper = await mountGrid(everyday, api);

    expect(tabTexts(wrapper)).toEqual([
      "Sun 20 Sep 2 gaps",
      "Today 24 Sep 3 gaps",
      "Sat 26 Sep 4 gaps",
    ]);
    expect(selectedTab(wrapper).text()).toContain("Today");
  });

  test("a meal added today stays on today's tab", async () => {
    const api = createFakeMealsApi();
    const wrapper = await mountGrid(everyday, api);

    await slotButton(wrapper, "Dinner").trigger("click");
    await buttonByText(wrapper, "Start planning dinner").trigger("click");
    await flushPromises();

    expect((await api.listMeals("home")).map((m) => [m.date, m.slot])).toEqual([
      ["2026-09-24", "dinner"],
    ]);
  });

  test("can go to another day and plan a meal there, which then keeps its tab", async () => {
    const api = createFakeMealsApi();
    const wrapper = await mountGrid(everyday, api);

    await fieldByLabel(wrapper, "Go to a day").setValue("2026-09-30");
    expect(selectedTab(wrapper).text()).toContain("30 Sep");

    await slotButton(wrapper, "Lunch").trigger("click");
    await buttonByText(wrapper, "Start planning lunch").trigger("click");
    await flushPromises();

    wrapper.unmount();
    history.replaceState(null, "", "/");
    const again = await mountGrid(everyday, api);
    expect(tabTexts(again)).toEqual(["Today 24 Sep 3 gaps", "Wed 30 Sep 3 gaps"]);
  });

  test("a day in the link opens even when it has no meals yet", async () => {
    history.replaceState(null, "", "/?day=2026-10-10");
    const wrapper = await mountGrid(everyday);

    expect(selectedTab(wrapper).text()).toContain("10 Oct");
  });
});

describe("when the meals cannot be loaded", () => {
  test("says so, and can try again", async () => {
    const backend = createFakeMealsApi();
    let fail = true;
    const api: FakeMealsApi = {
      ...backend,
      async listMeals(tripId) {
        if (fail) throw new Error("network down");
        return backend.listMeals(tripId);
      },
    };
    const wrapper = await mountGrid(tokyo, api);

    expect(wrapper.get('[role="alert"]').text()).toContain("network down");

    fail = false;
    await buttonByText(wrapper, "Try again").trigger("click");
    await flushPromises();
    expect(tabs(wrapper)).toHaveLength(5);
  });
});
