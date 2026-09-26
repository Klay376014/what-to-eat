// The trip grid, driven through the DOM against the in-memory fake. As in
// TripsHome.test.ts, nothing here asserts who may see or add a meal: the fake
// shows whatever it is seeded with, so such a test would prove nothing about
// the real policies (supabase/tests/database/meals_rls.test.sql does that).
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { aMeal, createFakeMealsApi, type FakeMealsApi } from "../test/fakeMealsApi.ts";
import {
  aProposal,
  createFakeProposalsApi,
  type FakeProposalsApi,
} from "../test/fakeProposalsApi.ts";
import { aTrip } from "../test/fakeTripsApi.ts";
import { calendarApiKey } from "../calendar/calendarApi.ts";
import {
  aConnection,
  createFakeCalendarApi,
  type FakeCalendarApi,
} from "../test/fakeCalendarApi.ts";
import { proposalsApiKey } from "../proposals/proposalsApi.ts";
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

async function mountGrid(
  trip: Trip,
  api: FakeMealsApi = createFakeMealsApi(),
  proposals: FakeProposalsApi = createFakeProposalsApi(),
  calendar: FakeCalendarApi = createFakeCalendarApi(),
  more: { openMeal?: { day: string; mealId: string } | null } = {},
) {
  const wrapper = mount(TripGrid, {
    props: { trip, ...more },
    global: {
      provide: {
        [mealsApiKey as symbol]: api,
        [proposalsApiKey as symbol]: proposals,
        [calendarApiKey as symbol]: calendar,
      },
    },
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
    history.replaceState(null, "", "/?trip=tokyo&day=2026-10-02");
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
    history.replaceState(null, "", "/?trip=tokyo&day=2026-10-01");
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

describe("a link straight to a meal (#15)", () => {
  test("opens the meal's day with its details open", async () => {
    const lunch = aMeal({ id: "lunch-4", tripId: "tokyo", date: "2026-10-04", slot: "lunch" });
    const proposals = createFakeProposalsApi();
    proposals.seed(aProposal({ mealId: "lunch-4", placeName: "Afuri" }));

    const wrapper = await mountGrid(
      tokyo,
      createFakeMealsApi({ meals: [lunch] }),
      proposals,
      createFakeCalendarApi(),
      { openMeal: { day: "2026-10-04", mealId: "lunch-4" } },
    );
    await flushPromises();

    expect(selectedTab(wrapper).text()).toContain("4 Oct");
    expect(slotButton(wrapper, "Lunch").attributes("aria-expanded")).toBe("true");
    expect(slotButton(wrapper, "Dinner").attributes("aria-expanded")).toBe("false");
    expect(panel(wrapper).text()).toContain("Afuri");
  });

  test("the day stays in the address, as if chosen", async () => {
    const lunch = aMeal({ id: "lunch-4", tripId: "tokyo", date: "2026-10-04", slot: "lunch" });

    await mountGrid(tokyo, createFakeMealsApi({ meals: [lunch] }), undefined, undefined, {
      openMeal: { day: "2026-10-04", mealId: "lunch-4" },
    });

    expect(new URLSearchParams(location.search).get("day")).toBe("2026-10-04");
  });

  test("a meal that no longer exists still opens its day, with nothing open", async () => {
    const wrapper = await mountGrid(tokyo, createFakeMealsApi(), undefined, undefined, {
      openMeal: { day: "2026-10-04", mealId: "gone" },
    });

    expect(selectedTab(wrapper).text()).toContain("4 Oct");
    expect(panel(wrapper).findAll('[aria-expanded="true"]')).toHaveLength(0);
  });
});

describe("which day opens", () => {
  test("a day in the link opens first", async () => {
    history.replaceState(null, "", "/?trip=tokyo&day=2026-10-04");
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

  test("a day chosen in one trip does not follow you into another", async () => {
    const wrapper = await mountGrid(tokyo);
    await tabFor(wrapper, "3 Oct").trigger("click");
    wrapper.unmount();

    // Switching trips, or a reload that opens on a different trip.
    const other = await mountGrid(everyday);

    expect(tabTexts(other)).toEqual(["Today 24 Sep 3 gaps"]);
    expect(selectedTab(other).text()).toContain("Today");
  });

  test("a day chosen in another dated trip does not pick the day here", async () => {
    const osaka = { ...tokyo, id: "osaka", name: "Osaka" };
    const wrapper = await mountGrid(osaka);
    await tabFor(wrapper, "5 Oct").trigger("click");
    wrapper.unmount();

    const again = await mountGrid(tokyo);
    // Before the trip with every day open, Tokyo opens on its first day with a gap.
    expect(selectedTab(again).text()).toContain("1 Oct");
  });
});

describe("the trip's today", () => {
  test("follows the trip's timezone when it changes", async () => {
    // 24 Sep, 02:00 UTC: 24 Sep in Taipei, still 23 Sep in Los Angeles.
    const wrapper = await mountGrid(everyday);
    expect(tabTexts(wrapper)).toEqual(["Today 24 Sep 3 gaps"]);

    // The same grid, not a remount: TripsHome keys the grid on the trip id only.
    // (Cast because the linter sees .vue files through a props-less shim.)
    const edited: Trip = { ...everyday, timezone: "America/Los_Angeles" };
    await wrapper.setProps({ trip: edited } as Record<string, unknown>);

    expect(tabTexts(wrapper)).toEqual(["Today 23 Sep 3 gaps"]);
    expect(selectedTab(wrapper).text()).toContain("23 Sep");
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

    expect(wrapper.text()).toContain("Nobody has proposed a restaurant for lunch yet.");
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
    await flushPromises();

    expect(wrapper.text()).toContain("Nobody has proposed a restaurant for lunch yet.");
    expect(wrapper.text()).not.toContain("Start planning lunch");
  });

  test("when someone else's lunch cannot be fetched yet, says it exists rather than that adding failed", async () => {
    const backend = createFakeMealsApi();
    let listFails = false;
    const api: FakeMealsApi = {
      ...backend,
      async listMeals(tripId) {
        if (listFails) throw new Error("network down");
        return backend.listMeals(tripId);
      },
    };
    const wrapper = await mountGrid(tokyo, api);
    await slotButton(wrapper, "Lunch").trigger("click");

    backend.seed(aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "lunch", proposals: 2 }));
    listFails = true;
    await buttonByText(wrapper, "Start planning lunch").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Someone else added lunch first");
    expect(wrapper.text()).toContain("Couldn't refresh the meals to show it: network down");
    expect(wrapper.text()).not.toContain("Couldn't add the meal");
  });

  test("a second lunch is refused, and the one someone else added first is shown", async () => {
    const api = createFakeMealsApi();
    const proposals = createFakeProposalsApi();
    const wrapper = await mountGrid(tokyo, api, proposals);
    await slotButton(wrapper, "Lunch").trigger("click");

    // Another member adds lunch, and two proposals, while this screen still shows none.
    api.seed(
      aMeal({ id: "theirs", tripId: "tokyo", date: "2026-10-01", slot: "lunch", proposals: 2 }),
    );
    proposals.seed(aProposal({ mealId: "theirs", placeName: "Tsuta" }));
    proposals.seed(aProposal({ mealId: "theirs", placeName: "Ichiran" }));
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

describe("renaming an other meal", () => {
  function withTea() {
    return createFakeMealsApi({
      meals: [
        aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "other", label: "Afternoon tea" }),
        aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "other", label: "Late-night snack" }),
      ],
    });
  }

  function renameForm(wrapper: Wrapper) {
    return fieldByLabel(wrapper, "New name").element.closest("form")!;
  }

  test("renames it in place, keeping its place on the trail", async () => {
    const api = withTea();
    const wrapper = await mountGrid(tokyo, api);

    await slotButton(wrapper, "Afternoon tea").trigger("click");
    await buttonByText(wrapper, "Rename").trigger("click");
    expect(fieldByLabel(wrapper, "New name").element.value).toBe("Afternoon tea");

    await fieldByLabel(wrapper, "New name").setValue("  Matcha and cake ");
    renameForm(wrapper).dispatchEvent(new Event("submit"));
    await flushPromises();

    expect(trail(wrapper).slice(3)).toEqual([
      "Matcha and cake Not planned",
      "Late-night snack Not planned",
    ]);
    expect(wrapper.find('input[type="text"]').exists()).toBe(false);

    wrapper.unmount();
    const again = await mountGrid(tokyo, api);
    expect(trail(again).slice(3)).toEqual([
      "Matcha and cake Not planned",
      "Late-night snack Not planned",
    ]);
  });

  test("says on the field what is wrong with the name, and keeps the old one", async () => {
    const wrapper = await mountGrid(tokyo, withTea());

    await slotButton(wrapper, "Afternoon tea").trigger("click");
    await buttonByText(wrapper, "Rename").trigger("click");
    const field = fieldByLabel(wrapper, "New name");
    await field.setValue("   ");
    renameForm(wrapper).dispatchEvent(new Event("submit"));
    await flushPromises();

    const errorId = field.attributes("aria-describedby")!.split(" ").at(-1)!;
    expect(wrapper.get(`[id="${errorId}"]`).text()).toBe(
      "Say what the meal is, like afternoon tea.",
    );
    expect(field.attributes("aria-invalid")).toBe("true");
    expect(trail(wrapper)[3]).toBe("Afternoon tea Not planned");
  });

  test("can be cancelled, leaving the name as it was", async () => {
    const wrapper = await mountGrid(tokyo, withTea());

    await slotButton(wrapper, "Afternoon tea").trigger("click");
    await buttonByText(wrapper, "Rename").trigger("click");
    await fieldByLabel(wrapper, "New name").setValue("Something else");
    await buttonByText(wrapper, "Cancel").trigger("click");

    expect(trail(wrapper)[3]).toBe("Afternoon tea Not planned");
    expect(buttonByText(wrapper, "Rename").exists()).toBe(true);
  });

  test("breakfast, lunch and dinner are named by their slot, so offer no rename", async () => {
    const api = createFakeMealsApi({
      meals: [aMeal({ tripId: "tokyo", date: "2026-10-01", slot: "dinner" })],
    });
    const wrapper = await mountGrid(tokyo, api);

    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Nobody has proposed a restaurant for dinner yet.");
    expect(() => buttonByText(wrapper, "Rename")).toThrow();
  });
});

describe("proposing from the grid", () => {
  test("a proposal made in a meal's details shows on its marker and in the day's summary", async () => {
    const api = createFakeMealsApi({
      meals: [aMeal({ id: "lunch-1", tripId: "tokyo", date: "2026-10-01", slot: "lunch" })],
    });
    const wrapper = await mountGrid(tokyo, api);
    expect(tabTexts(wrapper)[0]).toBe("Thu 1 Oct 3 gaps");

    await slotButton(wrapper, "Lunch").trigger("click");
    await flushPromises();
    await buttonByText(wrapper, "Propose a restaurant").trigger("click");
    await fieldByLabel(wrapper, "Restaurant name").setValue("Afuri Ramen Ebisu");
    await panel(wrapper).get("form").trigger("submit");
    await flushPromises();

    expect(trail(wrapper)[1]).toBe("Lunch Being discussed: 1 proposal");
    expect(tabTexts(wrapper)[0]).toBe("Thu 1 Oct 2 gaps");
    expect(panel(wrapper).text()).toContain("Afuri Ramen Ebisu");
  });

  test("opening a meal catches its marker up with proposals others made since", async () => {
    const api = createFakeMealsApi({
      meals: [aMeal({ id: "dinner-1", tripId: "tokyo", date: "2026-10-01", slot: "dinner" })],
    });
    const proposals = createFakeProposalsApi();
    const wrapper = await mountGrid(tokyo, api, proposals);
    proposals.seed(aProposal({ mealId: "dinner-1", placeName: "Tsuta" }));
    proposals.seed(aProposal({ mealId: "dinner-1", placeName: "Ichiran" }));

    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    expect(trail(wrapper)[2]).toBe("Dinner Being discussed: 2 proposals");
  });

  test("shows when a proposal was made on the trip's clock", async () => {
    const api = createFakeMealsApi({
      meals: [aMeal({ id: "dinner-1", tripId: "tokyo", date: "2026-10-01", slot: "dinner" })],
    });
    const proposals = createFakeProposalsApi({
      proposals: [
        aProposal({ mealId: "dinner-1", placeName: "Tsuta", createdAt: "2026-09-21T23:15:00Z" }),
      ],
    });
    const wrapper = await mountGrid(tokyo, api, proposals);

    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    expect(panel(wrapper).text()).toContain("Tue 22 Sep, 08:15");
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
    history.replaceState(null, "", "/?trip=home&day=2026-10-10");
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

describe("a meal's decision (#11)", () => {
  function dinnerWithAfuri() {
    const api = createFakeMealsApi({
      meals: [
        aMeal({ id: "dinner", tripId: "tokyo", date: "2026-10-01", slot: "dinner", proposals: 2 }),
      ],
    });
    const proposals = createFakeProposalsApi({
      proposals: [
        aProposal({ id: "afuri", mealId: "dinner", placeName: "Afuri" }),
        aProposal({ id: "tsuta", mealId: "dinner", placeName: "Tsuta" }),
      ],
    });
    return { api, proposals };
  }

  test("deciding in a meal's details shows on the trail at once, and clearing undoes it", async () => {
    const { api, proposals } = dinnerWithAfuri();
    const wrapper = await mountGrid(tokyo, api, proposals);
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();
    expect(trail(wrapper)).toContain("Dinner Decided: Afuri");

    await buttonByText(wrapper, "Clear the decision").trigger("click");
    await flushPromises();
    expect(trail(wrapper)).toContain("Dinner Being discussed: 2 proposals");
  });

  test("a decision someone else made since the grid loaded shows once the meal's details load", async () => {
    const { api, proposals } = dinnerWithAfuri();
    const wrapper = await mountGrid(tokyo, api, proposals);

    proposals.decideAs("dinner", "tsuta", { id: "bob", name: "Bob Lin" });
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    expect(trail(wrapper)).toContain("Dinner Decided: Tsuta");
  });

  test("the organiser is offered changing a member's decision; another member is not", async () => {
    for (const [myRole, offered] of [
      ["organiser", true],
      ["member", false],
    ] as const) {
      const { api, proposals } = dinnerWithAfuri();
      proposals.decideAs("dinner", "afuri", { id: "bob", name: "Bob Lin" });
      const wrapper = await mountGrid({ ...tokyo, myRole }, api, proposals);
      await slotButton(wrapper, "Dinner").trigger("click");
      await flushPromises();

      const labels = wrapper.findAll("button").map((b) => b.text().trim());
      expect(labels.includes("Clear the decision"), myRole).toBe(offered);
      wrapper.unmount();
    }
  });
});

describe("a meal's time", () => {
  function tokyoDinner(calendar?: FakeCalendarApi) {
    return createFakeMealsApi({
      meals: [aMeal({ id: "dinner", tripId: "tokyo", date: "2026-10-01", slot: "dinner" })],
      onStartTimeChange: (mealId) => calendar?.queue(mealId),
    });
  }

  test("is its slot's usual time, on the trip's clock", async () => {
    const wrapper = await mountGrid(tokyo, tokyoDinner());
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    expect(panel(wrapper).text()).toContain("Starts at 19:00 Tokyo time, dinner's usual time.");
  });

  test("can be set for this meal, and put back to the usual time", async () => {
    const api = tokyoDinner();
    const wrapper = await mountGrid(tokyo, api);
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "Change time").trigger("click");
    await fieldByLabel(wrapper, "Start time (Tokyo time)").setValue("20:30");
    await buttonByText(wrapper, "Save time").trigger("click");
    await flushPromises();

    expect(panel(wrapper).text()).toContain("Starts at 20:30 Tokyo time.");
    expect((await api.listMeals("tokyo"))[0]!.startTime).toBe("20:30");

    await buttonByText(wrapper, "Change time").trigger("click");
    await buttonByText(wrapper, "Use the usual time, 19:00").trigger("click");
    await flushPromises();

    expect(panel(wrapper).text()).toContain("Starts at 19:00 Tokyo time, dinner's usual time.");
    expect((await api.listMeals("tokyo"))[0]!.startTime).toBeNull();
  });

  test("needs a time to save one", async () => {
    const wrapper = await mountGrid(tokyo, tokyoDinner());
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "Change time").trigger("click");
    await fieldByLabel(wrapper, "Start time (Tokyo time)").setValue("");
    await buttonByText(wrapper, "Save time").trigger("click");
    await flushPromises();

    expect(panel(wrapper).text()).toContain("Say when it starts, like 19:30.");
  });

  test("a new time for a decided meal is written to its calendar event", async () => {
    const calendar = createFakeCalendarApi({
      connection: aConnection(),
      meals: [{ mealId: "dinner", status: "synced", error: null }],
    });
    const api = tokyoDinner(calendar);
    const proposals = createFakeProposalsApi({
      proposals: [aProposal({ id: "afuri", mealId: "dinner", placeName: "Afuri" })],
    });
    proposals.decideAs("dinner", "afuri", { id: "kenji", name: "Kenji" });
    const wrapper = await mountGrid(tokyo, api, proposals, calendar);
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();
    const before = calendar.syncs("tokyo");

    await buttonByText(wrapper, "Change time").trigger("click");
    await fieldByLabel(wrapper, "Start time (Tokyo time)").setValue("20:30");
    await buttonByText(wrapper, "Save time").trigger("click");
    await flushPromises();

    expect(calendar.syncs("tokyo")).toBe(before + 1);
    expect(panel(wrapper).text()).toContain("On Kenji's trip calendar, with everyone invited.");
  });
});

describe("a decided meal and the trip's calendar", () => {
  const kenji = aConnection();

  function decidable(calendar: FakeCalendarApi) {
    const api = createFakeMealsApi({
      meals: [aMeal({ id: "dinner", tripId: "tokyo", date: "2026-10-01", slot: "dinner" })],
    });
    const proposals = createFakeProposalsApi({
      proposals: [aProposal({ id: "afuri", mealId: "dinner", placeName: "Afuri" })],
      // The database queues the meal whenever its decision changes.
      onDecisionChange: (mealId, decided) => calendar.queue(mealId, decided),
    });
    return { api, proposals };
  }

  async function decideDinner(calendar: FakeCalendarApi) {
    const { api, proposals } = decidable(calendar);
    const wrapper = await mountGrid(tokyo, api, proposals, calendar);
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();
    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();
    return wrapper;
  }

  test("can be decided with no calendar, and says it isn't on one yet", async () => {
    const wrapper = await decideDinner(createFakeCalendarApi());

    expect(panel(wrapper).text()).toContain(
      "Not on a calendar yet: nobody has connected one for this trip.",
    );
    expect(wrapper.text()).toContain("1 decided meal isn't on a calendar yet.");
  });

  test("is written to the trip's calendar as soon as it is decided", async () => {
    const calendar = createFakeCalendarApi({ connection: kenji });
    const wrapper = await decideDinner(calendar);

    expect(panel(wrapper).text()).toContain("On Kenji's trip calendar, with everyone invited.");
  });

  test("has its event deleted when the decision is cleared", async () => {
    const calendar = createFakeCalendarApi({ connection: kenji });
    const wrapper = await decideDinner(calendar);

    await buttonByText(wrapper, "Clear the decision").trigger("click");
    await flushPromises();

    expect((await calendar.getStatus("tokyo")).meals).toEqual([]);
  });

  test("says so, on the meal, when its event could not be written", async () => {
    const calendar = createFakeCalendarApi({ connection: kenji });
    calendar.failWrites("Couldn't write the event: Google answered 403 (Forbidden)");
    const wrapper = await decideDinner(calendar);

    expect(panel(wrapper).get('[role="alert"]').text()).toBe(
      "Not on the calendar: Couldn't write the event: Google answered 403 (Forbidden)",
    );
  });
});

describe("a trip whose calendar stopped updating (#13)", () => {
  function dinnerOnKenjisCalendar(calendar: FakeCalendarApi) {
    const api = createFakeMealsApi({
      meals: [aMeal({ id: "dinner", tripId: "tokyo", date: "2026-10-01", slot: "dinner" })],
    });
    const proposals = createFakeProposalsApi({
      proposals: [aProposal({ id: "afuri", mealId: "dinner", placeName: "Afuri" })],
    });
    proposals.decideAs("dinner", "afuri", { id: "kenji", name: "Kenji" });
    return mountGrid(tokyo, api, proposals, calendar);
  }

  test("says so at the top of the trip, before the days, not only in the calendar card", async () => {
    const calendar = createFakeCalendarApi({
      connection: aConnection({ lapse: "revoked" }),
      meals: [{ mealId: "dinner", status: "synced", error: null }],
    });
    const wrapper = await dinnerOnKenjisCalendar(calendar);

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain("The trip calendar has stopped updating");
    expect(alert.text()).toContain("Kenji's Google Calendar access was removed");
    const tablist = wrapper.get('[role="tablist"]').element;
    expect(
      alert.element.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("is found out as the trip opens, even with nothing waiting to be written", async () => {
    const calendar = createFakeCalendarApi({
      connection: aConnection(),
      meals: [{ mealId: "dinner", status: "synced", error: null }],
    });
    calendar.lapseOnNextWrite("revoked");

    const wrapper = await dinnerOnKenjisCalendar(calendar);

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "The trip calendar has stopped updating",
    );
  });

  test("lets any member take the calendar over from there", async () => {
    const calendar = createFakeCalendarApi({ connection: aConnection({ lapse: "holder_left" }) });
    const wrapper = await dinnerOnKenjisCalendar(calendar);

    expect(wrapper.get('[role="alert"]').text()).toContain("Kenji left the trip");
    await buttonByText(wrapper, "Take over the calendar").trigger("click");
    await flushPromises();

    expect(calendar.startedConnecting).toEqual([{ tripId: "tokyo", replacing: "kenji-tokyo" }]);
  });

  test("tells each decided meal it will not follow later changes", async () => {
    const calendar = createFakeCalendarApi({
      connection: aConnection({ lapse: "revoked" }),
      meals: [{ mealId: "dinner", status: "synced", error: null }],
    });
    const wrapper = await dinnerOnKenjisCalendar(calendar);
    await slotButton(wrapper, "Dinner").trigger("click");
    await flushPromises();

    expect(panel(wrapper).text()).toContain(
      "On Kenji's trip calendar, but that calendar has stopped updating: a later change won't reach it.",
    );
  });

  test("writes nothing while it stays stopped", async () => {
    const calendar = createFakeCalendarApi({
      connection: aConnection({ lapse: "revoked" }),
      meals: [{ mealId: "dinner", status: "pending", error: null }],
    });
    await dinnerOnKenjisCalendar(calendar);

    expect(calendar.syncs("tokyo")).toBe(0);
  });
});
