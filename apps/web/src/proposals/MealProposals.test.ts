// A meal's proposals, driven through the DOM against the in-memory fake. As
// in TripGrid.test.ts, nothing here asserts who may see, propose or edit: the
// fake does whatever it is asked, so such a test would prove nothing about the
// real policies (supabase/tests/database/proposals_*.test.sql does that).
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, test } from "vite-plus/test";
import { buttonByText, fieldByLabel } from "../test/dom.ts";
import {
  aProposal,
  aVote,
  createFakeProposalsApi,
  type FakeProposalsApi,
} from "../test/fakeProposalsApi.ts";
import MealProposals from "./MealProposals.vue";
import type { ProposalsApi } from "./proposalsApi.ts";
import { proposalsApiKey } from "./proposalsApi.ts";

const MEAL = "meal-dinner";

async function mountProposals(
  api: ProposalsApi = createFakeProposalsApi(),
  { organiser = false }: { organiser?: boolean } = {},
) {
  const wrapper = mount(MealProposals, {
    props: { mealId: MEAL, mealName: "Dinner", timeZone: "Asia/Tokyo", organiser },
    global: { provide: { [proposalsApiKey as symbol]: api } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/**
 * Each proposal as a person reads it, line by line, whitespace collapsed.
 * Its votes are left out here and read through votesOn().
 */
function listed(wrapper: VueWrapper) {
  return wrapper.findAll("li").map((li) =>
    [...li.element.children]
      .filter((line) => !line.classList.contains("votes"))
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
      "Afuri Ramen Ebisu Proposed by you, Thu 24 Sep, 11:01 Decide on this Afuri Ramen Ebisu Edit Afuri Ramen Ebisu",
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
      "Tsuta Proposed by Alice Chen, Tue 22 Sep, 08:15 Decide on this Tsuta",
      "Ichiran Proposed by Bob Lin, Tue 22 Sep, 18:30 Decide on this Ichiran",
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
      "Tsuta Proposed by a member who deleted their account, Tue 22 Sep, 08:15 Decide on this Tsuta",
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
      "Afuri Ramen Ebisu Proposed by you, Thu 24 Sep, 11:01 Yuzu shio Decide on this Afuri Ramen Ebisu Edit Afuri Ramen Ebisu",
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

    const labels = item(wrapper, "Tsuta")
      .findAll("button")
      .map((b) => b.text());
    expect(labels.some((l) => l.startsWith("Edit"))).toBe(false);
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
          votes: [aVote({ voterId: "alice", voterName: "Alice Chen", value: 1 })],
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
    api.castAs(mine!.id, { id: "alice", name: "Alice Chen" }, 1);
    await buttonByText(wrapper, "Save").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Someone voted on it just now, so the name can no longer change. Your note was not saved either; save it again.",
    );
    expect(wrapper.findAll("label").map((l) => l.text())).not.toContain("Restaurant name");
    expect((await api.listProposals(MEAL))[0]!.placeName).toBe("Afuri");
  });
});

describe("voting", () => {
  /**
   * A proposal's tally, line by line, as a screen reader reads it: the
   * voters' faces are decorative, and their names are written out.
   */
  function tallyOf(wrapper: VueWrapper, name: string) {
    return item(wrapper, name)
      .findAll(".tally > *")
      .map((line) => {
        const read = line.element.cloneNode(true) as Element;
        read.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
        return (read.textContent ?? "").replace(/\s+/g, " ").trim();
      });
  }

  function voteButton(wrapper: VueWrapper, name: string, label: "+1" | "−1") {
    return buttonByText(item(wrapper, name), `${label} ${name}`);
  }

  function hasNotVotedOn(wrapper: VueWrapper, name: string) {
    return item(wrapper, name).find(".unvoted").exists();
  }

  async function press(wrapper: VueWrapper, name: string, label: "+1" | "−1") {
    await voteButton(wrapper, name, label).trigger("click");
    await flushPromises();
  }

  function withAfuri(votes = [] as Parameters<typeof aVote>[0][]) {
    return createFakeProposalsApi({
      proposals: [aProposal({ mealId: MEAL, placeName: "Afuri", votes: votes.map(aVote) })],
    });
  }

  test("a proposal nobody has voted on says so, and marks that you have not voted", async () => {
    const wrapper = await mountProposals(withAfuri());

    expect(tallyOf(wrapper, "Afuri")).toEqual(["No votes yet."]);
    expect(hasNotVotedOn(wrapper, "Afuri")).toBe(true);
    expect(voteButton(wrapper, "Afuri", "+1").attributes("aria-pressed")).toBe("false");
    expect(voteButton(wrapper, "Afuri", "−1").attributes("aria-pressed")).toBe("false");
  });

  test("+1 counts you for it, and shows your vote pressed", async () => {
    const api = withAfuri();
    const wrapper = await mountProposals(api);

    await press(wrapper, "Afuri", "+1");

    expect(tallyOf(wrapper, "Afuri")).toEqual(["1 for: you"]);
    expect(voteButton(wrapper, "Afuri", "+1").attributes("aria-pressed")).toBe("true");
    // Withdrawing has no button of its own, so the way back is said.
    expect(item(wrapper, "Afuri").text()).toContain("Press your vote again to take it back.");
    expect(voteButton(wrapper, "Afuri", "−1").attributes("aria-pressed")).toBe("false");
    expect(hasNotVotedOn(wrapper, "Afuri")).toBe(false);
    expect((await api.listProposals(MEAL))[0]!.votes.map((v) => v.value)).toEqual([1]);
  });

  test("−1 after +1 changes your vote rather than adding a second", async () => {
    const api = withAfuri();
    const wrapper = await mountProposals(api);

    await press(wrapper, "Afuri", "+1");
    await press(wrapper, "Afuri", "−1");

    expect(tallyOf(wrapper, "Afuri")).toEqual(["1 against: you"]);
    expect(voteButton(wrapper, "Afuri", "+1").attributes("aria-pressed")).toBe("false");
    expect(voteButton(wrapper, "Afuri", "−1").attributes("aria-pressed")).toBe("true");
    expect((await api.listProposals(MEAL))[0]!.votes).toHaveLength(1);
  });

  test("pressing your vote again withdraws it, back to no opinion", async () => {
    const api = withAfuri();
    const wrapper = await mountProposals(api);

    await press(wrapper, "Afuri", "−1");
    await press(wrapper, "Afuri", "−1");

    expect(tallyOf(wrapper, "Afuri")).toEqual(["No votes yet."]);
    expect(voteButton(wrapper, "Afuri", "−1").attributes("aria-pressed")).toBe("false");
    expect(hasNotVotedOn(wrapper, "Afuri")).toBe(true);
    expect(item(wrapper, "Afuri").text()).not.toContain("Press your vote again");
    expect((await api.listProposals(MEAL))[0]!.votes).toEqual([]);
  });

  test("shows who voted which way, a departed member's vote included", async () => {
    const wrapper = await mountProposals(
      withAfuri([
        { voterId: "bob", voterName: "Bob Lin", value: -1 },
        { voterId: "dave", voterName: "Dave Ho", value: 1 },
        { voterId: "alice", voterName: "Alice Chen", value: 1 },
      ]),
    );

    expect(tallyOf(wrapper, "Afuri")).toEqual(["2 for: Alice Chen, Dave Ho", "1 against: Bob Lin"]);
    expect(hasNotVotedOn(wrapper, "Afuri")).toBe(true);
  });

  test("your vote joins the others, and you are named first", async () => {
    const wrapper = await mountProposals(
      withAfuri([{ voterId: "alice", voterName: "Alice Chen", value: 1 }]),
    );

    await press(wrapper, "Afuri", "+1");

    expect(tallyOf(wrapper, "Afuri")).toEqual(["2 for: you, Alice Chen"]);
  });

  test("says at a glance how many proposals you have not voted on", async () => {
    const api = createFakeProposalsApi({
      proposals: [
        aProposal({ mealId: MEAL, placeName: "Afuri" }),
        aProposal({ mealId: MEAL, placeName: "Tsuta" }),
      ],
    });
    const wrapper = await mountProposals(api);
    const summary = () => wrapper.get(".vote-summary").text();

    expect(summary()).toBe("You haven't voted on 2 of 2 proposals.");

    await press(wrapper, "Afuri", "+1");
    expect(summary()).toBe("You haven't voted on 1 of 2 proposals.");
    expect(hasNotVotedOn(wrapper, "Afuri")).toBe(false);
    expect(hasNotVotedOn(wrapper, "Tsuta")).toBe(true);

    await press(wrapper, "Tsuta", "−1");
    expect(summary()).toBe("You've voted on every proposal.");
  });

  test("a new proposal counts as one you have not voted on yet", async () => {
    const wrapper = await mountProposals();

    await propose(wrapper, { name: "Afuri" });

    expect(wrapper.get(".vote-summary").text()).toBe("You haven't voted on 1 of 1 proposal.");
  });

  test("a failed vote says why and leaves the tally as it was", async () => {
    const api = withAfuri([{ voterId: "alice", voterName: "Alice Chen", value: 1 }]);
    api.vote = async () => {
      throw new Error("network down");
    };
    const wrapper = await mountProposals(api);

    await press(wrapper, "Afuri", "+1");

    expect(item(wrapper, "Afuri").get('[role="alert"]').text()).toBe(
      "Couldn't save your vote: network down",
    );
    expect(tallyOf(wrapper, "Afuri")).toEqual(["1 for: Alice Chen"]);
    expect(voteButton(wrapper, "Afuri", "+1").attributes("aria-pressed")).toBe("false");
  });

  test("votes that landed meanwhile show up when you vote", async () => {
    const api = withAfuri();
    const wrapper = await mountProposals(api);
    const [afuri] = await api.listProposals(MEAL);

    api.castAs(afuri!.id, { id: "bob", name: "Bob Lin" }, -1);
    await press(wrapper, "Afuri", "+1");

    expect(tallyOf(wrapper, "Afuri")).toEqual(["1 for: you", "1 against: Bob Lin"]);
  });

  test("voting on your own proposal locks its name, and withdrawing the last vote unlocks it", async () => {
    const wrapper = await mountProposals();
    await propose(wrapper, { name: "Afuri" });

    await press(wrapper, "Afuri", "+1");
    await buttonByText(wrapper, "Edit Afuri").trigger("click");
    expect(wrapper.findAll("label").map((l) => l.text())).not.toContain("Restaurant name");
    await buttonByText(wrapper, "Cancel").trigger("click");

    await press(wrapper, "Afuri", "+1");
    await buttonByText(wrapper, "Edit Afuri").trigger("click");
    expect(wrapper.findAll("label").map((l) => l.text())).toContain("Restaurant name");
  });
});

describe("deciding", () => {
  const ALICE = { id: "alice", name: "Alice Chen" };

  function withTwo(options: Partial<Parameters<typeof aProposal>[0]> = {}) {
    return createFakeProposalsApi({
      proposals: [
        aProposal({
          id: "afuri",
          mealId: MEAL,
          placeName: "Afuri",
          sourceUrl: "https://maps.app.goo.gl/AbCdEf123",
          note: "Near the station",
          proposerName: "Bob Lin",
          ...options,
        }),
        aProposal({ id: "tsuta", mealId: MEAL, placeName: "Tsuta" }),
      ],
    });
  }

  /** The decision as a person reads it, line by line, whitespace collapsed. */
  function decisionLines(wrapper: VueWrapper) {
    const panel = wrapper.find(".decision");
    if (!panel.exists()) return null;
    return [...panel.element.children].map((line) =>
      (line.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
  }

  function buttons(wrapper: VueWrapper) {
    return wrapper.findAll("button").map((b) => b.text().replace(/\s+/g, " ").trim());
  }

  function decided(wrapper: VueWrapper) {
    return (wrapper.emitted<[string | null]>("decided") ?? []).map(([name]) => name);
  }

  test("an undecided meal offers every member deciding on each proposal", async () => {
    const wrapper = await mountProposals(withTwo());

    expect(decisionLines(wrapper)).toBeNull();
    expect(buttons(wrapper)).toContain("Decide on this Afuri");
    expect(buttons(wrapper)).toContain("Decide on this Tsuta");
    expect(decided(wrapper)).toEqual([null]);
  });

  test("deciding shows the restaurant, its Maps link, the proposer's note, and who decided when", async () => {
    const api = withTwo();
    const wrapper = await mountProposals(api);

    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();

    expect(decisionLines(wrapper)).toEqual([
      "Decided",
      "Afuri",
      "Near the station",
      "Decided by you, Thu 24 Sep, 11:01",
      "Open in Google Maps: Afuri Clear the decision",
    ]);
    const link = wrapper.get(".decision a");
    expect(link.attributes("href")).toBe("https://www.google.com/maps/search/?api=1&query=Afuri");
    expect(item(wrapper, "Afuri").find(".decided-mark").exists()).toBe(true);
    expect(item(wrapper, "Tsuta").find(".decided-mark").exists()).toBe(false);
    expect((await api.getDecision(MEAL))?.proposalId).toBe("afuri");
  });

  test("tells the grid at once, so the slot shows the decision", async () => {
    const wrapper = await mountProposals(withTwo());

    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();

    expect(decided(wrapper)).toEqual([null, "Afuri"]);
  });

  test("the member who decided changes it to another proposal", async () => {
    const api = withTwo();
    const wrapper = await mountProposals(api);
    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();

    expect(buttons(wrapper)).not.toContain("Decide on this Afuri");
    await buttonByText(wrapper, "Decide on this instead Tsuta").trigger("click");
    await flushPromises();

    expect(decisionLines(wrapper)?.[1]).toBe("Tsuta");
    expect(decided(wrapper)).toEqual([null, "Afuri", "Tsuta"]);
    expect((await api.getDecision(MEAL))?.proposalId).toBe("tsuta");
  });

  test("the member who decided clears it, and the meal is open again", async () => {
    const api = withTwo();
    const wrapper = await mountProposals(api);
    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "Clear the decision").trigger("click");
    await flushPromises();

    expect(decisionLines(wrapper)).toBeNull();
    expect(buttons(wrapper)).toContain("Decide on this Afuri");
    expect(decided(wrapper)).toEqual([null, "Afuri", null]);
    expect(await api.getDecision(MEAL)).toBeNull();
  });

  test("a member who did not decide sees the decision but is offered no way to change or clear it", async () => {
    const api = withTwo();
    api.decideAs(MEAL, "afuri", ALICE);
    const wrapper = await mountProposals(api);

    expect(decisionLines(wrapper)?.slice(0, 2)).toEqual(["Decided", "Afuri"]);
    expect(decisionLines(wrapper)).toContain("Decided by Alice Chen, Thu 24 Sep, 11:01");
    expect(decided(wrapper)).toEqual(["Afuri"]);
    const labels = buttons(wrapper);
    expect(labels.some((l) => l.startsWith("Decide on this"))).toBe(false);
    expect(labels).not.toContain("Clear the decision");
  });

  test("the organiser may change or clear someone else's decision", async () => {
    const api = withTwo();
    api.decideAs(MEAL, "afuri", ALICE);
    const wrapper = await mountProposals(api, { organiser: true });

    expect(buttons(wrapper)).toContain("Decide on this instead Tsuta");
    await buttonByText(wrapper, "Clear the decision").trigger("click");
    await flushPromises();

    expect(decisionLines(wrapper)).toBeNull();
    expect(await api.getDecision(MEAL)).toBeNull();
  });

  test("a decision whose decider deleted their account says so", async () => {
    const api = withTwo();
    api.decideAs(MEAL, "afuri", { id: "gone", name: null });
    const decision = await api.getDecision(MEAL);
    const orphaned = createFakeProposalsApi({
      proposals: await api.listProposals(MEAL),
      decisions: [{ ...decision!, decidedBy: null }],
    });
    const wrapper = await mountProposals(orphaned);

    expect(decisionLines(wrapper)).toContain(
      "Decided by a member who deleted their account, Thu 24 Sep, 11:01",
    );
  });

  test("when someone else decided first, says so and shows their decision", async () => {
    const api = withTwo();
    const wrapper = await mountProposals(api);

    api.decideAs(MEAL, "tsuta", ALICE);
    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Alice Chen decided it just now, so your choice was not saved.",
    );
    expect(decisionLines(wrapper)?.[1]).toBe("Tsuta");
    expect(decided(wrapper)).toEqual([null, "Tsuta"]);
  });

  test("a failed decision says why and leaves the meal as it was", async () => {
    const api = withTwo();
    api.decide = async () => {
      throw new Error("network down");
    };
    const wrapper = await mountProposals(api);

    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe("Couldn't decide: network down");
    expect(decisionLines(wrapper)).toBeNull();
  });

  test("the decided restaurant's name stays, and its proposer is told why", async () => {
    const api = withTwo({ proposedBy: "me", proposedByMe: true });
    const wrapper = await mountProposals(api);
    await buttonByText(wrapper, "Decide on this Afuri").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "Edit Afuri").trigger("click");

    expect(wrapper.findAll("label").map((l) => l.text())).not.toContain("Restaurant name");
    expect(wrapper.get("form").text()).toContain(
      "It's the decided restaurant, so the name stays as it was chosen. You can still change the note.",
    );
  });
});
