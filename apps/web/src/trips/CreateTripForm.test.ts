// Component tests drive the UI the way a person would -- find a field by its
// label, type, click -- and assert on what the screen then shows. The data
// layer is an in-memory fake at the TripsApi boundary (src/test/). These
// tests never assert who may see or change what: a fake cannot prove a
// policy, so access control is tested only in supabase/tests/database/.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createFakeTripsApi } from "../test/fakeTripsApi.ts";
import { fieldByLabel } from "../test/dom.ts";
import CreateTripForm from "./CreateTripForm.vue";
import type { Trip } from "./trip.ts";
import { tripsApiKey, type TripsApi } from "./tripsApi.ts";

beforeEach(() => {
  vi.stubEnv("TZ", "Asia/Taipei"); // the "browser's" timezone
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function mountForm(api: TripsApi = createFakeTripsApi()) {
  const wrapper = mount(CreateTripForm, {
    global: { provide: { [tripsApiKey as symbol]: api } },
    attachTo: document.body,
  });
  return { wrapper, api };
}

describe("creating a trip", () => {
  test("the timezone starts on the browser's own zone", () => {
    const { wrapper } = mountForm();

    const timezone = fieldByLabel<HTMLSelectElement>(wrapper, "Timezone");
    expect(timezone.element.value).toBe("Asia/Taipei");
  });

  test("offers IANA zones to choose from", () => {
    const { wrapper } = mountForm();

    const zones = fieldByLabel<HTMLSelectElement>(wrapper, "Timezone")
      .findAll("option")
      .map((option) => option.element.value);
    expect(zones).toContain("Asia/Tokyo");
    expect(zones).toContain("Europe/London");
  });

  test("creates a trip with a name, dates and a chosen timezone", async () => {
    const { wrapper } = mountForm();

    await fieldByLabel(wrapper, "Trip name").setValue("  Tokyo in autumn ");
    await fieldByLabel(wrapper, "Start date").setValue("2026-10-01");
    await fieldByLabel(wrapper, "End date").setValue("2026-10-05");
    await fieldByLabel(wrapper, "Timezone").setValue("Asia/Tokyo");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    const [[created]] = wrapper.emitted<[Trip]>("created")!;
    expect(created).toMatchObject({
      name: "Tokyo in autumn",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      timezone: "Asia/Tokyo",
    });
  });

  test("dates are optional", async () => {
    const { wrapper } = mountForm();

    await fieldByLabel(wrapper, "Trip name").setValue("Dinner at home");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    const [[created]] = wrapper.emitted<[Trip]>("created")!;
    expect(created).toMatchObject({
      name: "Dinner at home",
      startDate: null,
      endDate: null,
      timezone: "Asia/Taipei",
    });
  });

  test("a trip needs a name", async () => {
    const { wrapper } = mountForm();

    await fieldByLabel(wrapper, "Trip name").setValue("   ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Give the trip a name.");
    expect(wrapper.emitted("created")).toBeUndefined();
  });

  test("a start date needs an end date", async () => {
    const { wrapper } = mountForm();

    await fieldByLabel(wrapper, "Trip name").setValue("Seoul");
    await fieldByLabel(wrapper, "Start date").setValue("2026-12-20");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Add an end date, or clear the start date.");
    expect(wrapper.emitted("created")).toBeUndefined();
  });

  test("a failure to save is shown, and the form keeps what was typed", async () => {
    const api = createFakeTripsApi();
    api.createTrip = async () => {
      throw new Error("network down");
    };
    const { wrapper } = mountForm(api);

    await fieldByLabel(wrapper, "Trip name").setValue("Osaka");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("network down");
    expect(fieldByLabel<HTMLInputElement>(wrapper, "Trip name").element.value).toBe("Osaka");
  });
});
