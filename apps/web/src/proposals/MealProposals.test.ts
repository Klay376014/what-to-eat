// A meal's proposals, driven through the DOM against the in-memory fake. As
// in TripGrid.test.ts, nothing here asserts who may see, propose or edit: the
// fake does whatever it is asked, so such a test would prove nothing about the
// real policies (supabase/tests/database/proposals_*.test.sql does that).
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import { buttonByText, fieldByLabel } from "../test/dom.ts";
import {
  aProposal,
  createFakeProposalsApi,
  type FakeProposalsApi,
} from "../test/fakeProposalsApi.ts";
import MealProposals from "./MealProposals.vue";
import type { ProposalsApi } from "./proposalsApi.ts";
import { proposalsApiKey } from "./proposalsApi.ts";

const MEAL = "meal-dinner";

async function mountProposals(api: ProposalsApi = createFakeProposalsApi()) {
  const wrapper = mount(MealProposals, {
    props: { mealId: MEAL, mealName: "Dinner", timeZone: "Asia/Tokyo" },
    global: { provide: { [proposalsApiKey as symbol]: api } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** Each proposal as a person reads it, line by line, whitespace collapsed. */
function listed(wrapper: VueWrapper) {
  return wrapper
    .findAll("li")
    .map((li) =>
      [...li.element.children]
        .map((line) => (line.textContent ?? "").replace(/\s+/g, " ").trim())
        .join(" "),
    );
}

function item(wrapper: VueWrapper, name: string) {
  const li = wrapper.findAll("li").find((l) => l.text().includes(name));
  if (!li) throw new Error(`No proposal "${name}"`);
  return li;
}

async function propose(
  wrapper: VueWrapper,
  fields: { link?: string; name?: string; note?: string },
) {
  await buttonByText(wrapper, "Propose a restaurant").trigger("click");
  if (fields.link !== undefined) {
    await fieldByLabel(wrapper, "Google Maps link (optional)").setValue(fields.link);
  }
  if (fields.name !== undefined)
    await fieldByLabel(wrapper, "Restaurant name").setValue(fields.name);
  if (fields.note !== undefined) {
    await fieldByLabel<HTMLTextAreaElement>(wrapper, "Note (optional)").setValue(fields.note);
  }
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

function counts(wrapper: VueWrapper) {
  return (wrapper.emitted<[number]>("count") ?? []).map(([n]) => n);
}

describe("proposing a restaurant", () => {
  test("a meal with none says so", async () => {
    const wrapper = await mountProposals();

    expect(wrapper.text()).toContain("Nobody has proposed a restaurant for dinner yet.");
    expect(listed(wrapper)).toEqual([]);
  });

  test("a typed name alone is enough, and the proposal is listed as yours, with when", async () => {
    const wrapper = await mountProposals();

    await propose(wrapper, { name: "  Afuri Ramen Ebisu " });

    expect(listed(wrapper)).toEqual([
      "Afuri Ramen Ebisu Proposed by you, Thu 24 Sep, 11:01 Edit Afuri Ramen Ebisu",
    ]);
    expect(wrapper.text()).not.toContain("Nobody has proposed");
    // The form closes, ready for the next one.
    expect(wrapper.find("form").exists()).toBe(false);
    expect(document.activeElement?.textContent?.trim()).toBe("Propose a restaurant");
  });

  test("tells the grid how many proposals the meal has", async () => {
    const api = createFakeProposalsApi({
      proposals: [aProposal({ mealId: MEAL, placeName: "Tsuta" })],
    });
    const wrapper = await mountProposals(api);

    await propose(wrapper, { name: "Afuri" });

    expect(counts(wrapper)).toEqual([1, 2]);
  });

  test("a Maps link and a note go with it, and the link opens Google Maps through the official scheme", async () => {
    const api = createFakeProposalsApi();
    const wrapper = await mountProposals(api);

    await propose(wrapper, {
      link: " https://maps.app.goo.gl/AbCdEf123?g_st=ic ",
      name: "Afuri Ramen Ebisu",
      note: "No reservation needed.\n20 min walk from the hotel.",
    });

    const proposal = item(wrapper, "Afuri Ramen Ebisu");
    expect(proposal.get(".note").text()).toBe(
      "No reservation needed.\n20 min walk from the hotel.",
    );
    const link = proposal.get("a");
    expect(link.text().replace(/\s+/g, " ")).toBe("Open in Google Maps: Afuri Ramen Ebisu");
    expect(link.attributes("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Afuri%20Ramen%20Ebisu",
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
    // The link is kept as pasted (trimmed), for #9 to resolve.
    expect((await api.listProposals(MEAL))[0]!.sourceUrl).toBe(
      "https://maps.app.goo.gl/AbCdEf123?g_st=ic",
    );
  });

  test("without a link there is nothing to open in Maps", async () => {
    const wrapper = await mountProposals();

    await propose(wrapper, { name: "Afuri" });

    expect(item(wrapper, "Afuri").find("a").exists()).toBe(false);
  });

  test("a restaurant needs a name, said on the field, and nothing is proposed", async () => {
    const api = createFakeProposalsApi();
    const wrapper = await mountProposals(api);

    await propose(wrapper, { link: "https://maps.app.goo.gl/AbCdEf123", name: "   " });

    const name = fieldByLabel(wrapper, "Restaurant name");
    expect(name.attributes("aria-invalid")).toBe("true");
    expect(wrapper.text()).toContain("Say which restaurant.");
    expect(await api.listProposals(MEAL)).toEqual([]);
  });

  test("a link that is not a link is pointed out, and leaving it out still proposes", async () => {
    const api = createFakeProposalsApi();
    const wrapper = await mountProposals(api);

    await propose(wrapper, { link: "maps.app.goo.gl/AbCdEf123", name: "Afuri" });
    expect(fieldByLabel(wrapper, "Google Maps link (optional)").attributes("aria-invalid")).toBe(
      "true",
    );
    expect(wrapper.text()).toContain("Paste the whole link, starting with https://");
    expect(await api.listProposals(MEAL)).toEqual([]);

    await fieldByLabel(wrapper, "Google Maps link (optional)").setValue("");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(listed(wrapper)[0]).toContain("Afuri");
  });

  test("can be cancelled, proposing nothing", async () => {
    const api = createFakeProposalsApi();
    const wrapper = await mountProposals(api);

    await buttonByText(wrapper, "Propose a restaurant").trigger("click");
    await fieldByLabel(wrapper, "Restaurant name").setValue("Afuri");
    await buttonByText(wrapper, "Cancel").trigger("click");

    expect(wrapper.find("form").exists()).toBe(false);
    expect(await api.listProposals(MEAL)).toEqual([]);
  });

  test("a failed proposal says why and keeps what was typed", async () => {
    const api = createFakeProposalsApi();
    api.propose = async () => {
      throw new Error("network down");
    };
    const wrapper = await mountProposals(api);

    await propose(wrapper, { name: "Afuri" });

    expect(wrapper.get('[role="alert"]').text()).toBe("Couldn't propose it: network down");
    expect(fieldByLabel(wrapper, "Restaurant name").element.value).toBe("Afuri");
  });
});

describe("the list", () => {
  test("shows every proposal oldest first, who proposed it and when, on the trip's clock", async () => {
    const api = createFakeProposalsApi({
      proposals: [
        aProposal({
          mealId: MEAL,
          placeName: "Ichiran",
          proposerName: "Bob Lin",
          createdAt: "2026-09-22T09:30:00Z",
        }),
        aProposal({
          mealId: MEAL,
          placeName: "Tsuta",
          proposerName: "Alice Chen",
          createdAt: "2026-09-21T23:15:00Z",
        }),
        aProposal({ mealId: "another-meal", placeName: "Elsewhere" }),
      ],
    });
    const wrapper = await mountProposals(api);

    expect(listed(wrapper)).toEqual([
      "Tsuta Proposed by Alice Chen, Tue 22 Sep, 08:15",
      "Ichiran Proposed by Bob Lin, Tue 22 Sep, 18:30",
    ]);
  });

  test("a proposal outlives its proposer's account, and says so", async () => {
    const api = createFakeProposalsApi({
      proposals: [
        aProposal({
          mealId: MEAL,
          placeName: "Tsuta",
          proposedBy: null,
          proposerName: null,
          createdAt: "2026-09-21T23:15:00Z",
        }),
      ],
    });
    const wrapper = await mountProposals(api);

    expect(listed(wrapper)).toEqual([
      "Tsuta Proposed by a member who deleted their account, Tue 22 Sep, 08:15",
    ]);
  });

  test("offers no delete, not even on your own proposal", async () => {
    const wrapper = await mountProposals();

    await propose(wrapper, { name: "Afuri" });

    const labels = wrapper.findAll("button").map((b) => b.text());
    expect(labels.some((l) => /delete|remove/i.test(l))).toBe(false);
  });

  test("says when the proposals cannot be loaded, and can try again", async () => {
    const api = createFakeProposalsApi({
      proposals: [aProposal({ mealId: MEAL, placeName: "Tsuta" })],
    });
    const list = api.listProposals.bind(api);
    let fail = true;
    api.listProposals = async (mealId) => {
      if (fail) throw new Error("offline");
      return list(mealId);
    };
    const wrapper = await mountProposals(api);

    expect(wrapper.get('[role="alert"]').text()).toBe("Couldn't load the proposals: offline");
    expect(wrapper.text()).not.toContain("Nobody has proposed");

    fail = false;
    await buttonByText(wrapper, "Try again").trigger("click");
    await flushPromises();

    expect(listed(wrapper)[0]).toContain("Tsuta");
  });
});

describe("editing your own proposal", () => {
  async function withMine(api: FakeProposalsApi = createFakeProposalsApi()) {
    const wrapper = await mountProposals(api);
    await propose(wrapper, { name: "Afuri", note: "Near the station" });
    return wrapper;
  }

  test("changes its name and note in place", async () => {
    const wrapper = await withMine();

    await buttonByText(wrapper, "Edit Afuri").trigger("click");
    const name = fieldByLabel(wrapper, "Restaurant name");
    expect(name.element.value).toBe("Afuri");
    await name.setValue("Afuri Ramen Ebisu");
    await fieldByLabel<HTMLTextAreaElement>(wrapper, "Note (optional)").setValue("Yuzu shio");
    await buttonByText(wrapper, "Save").trigger("click");
    await flushPromises();

    expect(listed(wrapper)).toEqual([
      "Afuri Ramen Ebisu Proposed by you, Thu 24 Sep, 11:01 Yuzu shio Edit Afuri Ramen Ebisu",
    ]);
    expect(document.activeElement?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Edit Afuri Ramen Ebisu",
    );
  });

  test("clearing the note removes it", async () => {
    const wrapper = await withMine();

    await buttonByText(wrapper, "Edit Afuri").trigger("click");
    await fieldByLabel<HTMLTextAreaElement>(wrapper, "Note (optional)").setValue("  ");
    await buttonByText(wrapper, "Save").trigger("click");
    await flushPromises();

    expect(item(wrapper, "Afuri").find(".note").exists()).toBe(false);
  });

  test("keeps the name as it was when the new one is blank", async () => {
    const wrapper = await withMine();

    await buttonByText(wrapper, "Edit Afuri").trigger("click");
    await fieldByLabel(wrapper, "Restaurant name").setValue(" ");
    await buttonByText(wrapper, "Save").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Say which restaurant.");
    await buttonByText(wrapper, "Cancel").trigger("click");
    expect(listed(wrapper)[0]).toMatch(/^Afuri Proposed by you/);
  });

  test("is not offered on someone else's proposal", async () => {
    const api = createFakeProposalsApi({
      proposals: [aProposal({ mealId: MEAL, placeName: "Tsuta", proposerName: "Alice Chen" })],
    });
    const wrapper = await mountProposals(api);

    expect(item(wrapper, "Tsuta").find("button").exists()).toBe(false);
  });
});

describe("once someone has voted", () => {
  test("the name is read-only and the form says why, while the note can still change", async () => {
    const api = createFakeProposalsApi({
      proposals: [
        aProposal({
          mealId: MEAL,
          placeName: "Afuri Ramen Ebisu",
          proposedByMe: true,
          nameLocked: true,
          note: "Near the station",
        }),
      ],
    });
    const wrapper = await mountProposals(api);

    await buttonByText(wrapper, "Edit Afuri Ramen Ebisu").trigger("click");

    expect(wrapper.findAll("label").map((l) => l.text())).not.toContain("Restaurant name");
    expect(wrapper.get("form").text()).toContain(
      "Someone has voted on it, so the name stays as they saw it. You can still change the note.",
    );

    await fieldByLabel<HTMLTextAreaElement>(wrapper, "Note (optional)").setValue("Cash only");
    await buttonByText(wrapper, "Save").trigger("click");
    await flushPromises();

    expect(item(wrapper, "Afuri Ramen Ebisu").get(".note").text()).toBe("Cash only");
    expect((await api.listProposals(MEAL))[0]!.placeName).toBe("Afuri Ramen Ebisu");
  });

  test("a vote that lands while the name is being edited is explained, and the name locks", async () => {
    const api = createFakeProposalsApi();
    const wrapper = await mountProposals(api);
    await propose(wrapper, { name: "Afuri" });
    const [mine] = await api.listProposals(MEAL);

    await buttonByText(wrapper, "Edit Afuri").trigger("click");
    await fieldByLabel(wrapper, "Restaurant name").setValue("Somewhere else");
    api.vote(mine!.id);
    await buttonByText(wrapper, "Save").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Someone voted on it just now, so the name can no longer change. Your note was not saved either; save it again.",
    );
    expect(wrapper.findAll("label").map((l) => l.text())).not.toContain("Restaurant name");
    expect((await api.listProposals(MEAL))[0]!.placeName).toBe("Afuri");
  });
});
