// Nudging the people who have not voted (#16), driven through a meal's
// proposals as a member would. The fake refuses what the database refuses,
// so a refusal can be shown, but nothing here proves who may nudge or that
// the cooldown holds: supabase/tests/database/nudges.test.sql does that.
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { buttonByText } from "../test/dom.ts";
import {
  aProposal,
  aVote,
  createFakeProposalsApi,
  type FakeProposalsApi,
} from "../test/fakeProposalsApi.ts";
import MealProposals from "./MealProposals.vue";
import { proposalsApiKey } from "./proposalsApi.ts";

const MEAL = "meal-dinner";
const NOW = "2026-10-02T09:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * HOUR).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const bob = { userId: "bob", name: "Bob" };
const carol = { userId: "carol", name: "Carol" };
const frank = { userId: "frank", name: "Frank" };

/** Dinner with one proposal Bob voted on; Carol and Frank have not voted. */
function dinner(
  options: { lastNudged?: string; everyoneVoted?: boolean; decided?: boolean } = {},
): FakeProposalsApi {
  const proposal = aProposal({
    mealId: MEAL,
    placeName: "Afuri",
    votes: [
      aVote({ voterId: "bob", voterName: "Bob", value: 1 }),
      ...(options.everyoneVoted
        ? [
            aVote({ voterId: "carol", voterName: "Carol", value: -1 }),
            aVote({ voterId: "frank", voterName: "Frank", value: 1 }),
          ]
        : []),
    ],
  });
  return createFakeProposalsApi({
    proposals: [proposal],
    members: [bob, carol, frank],
    lastNudged: options.lastNudged ? { [MEAL]: options.lastNudged } : {},
    decisions: options.decided
      ? [
          {
            mealId: MEAL,
            proposalId: proposal.id,
            decidedBy: "bob",
            decidedByMe: false,
            deciderName: "Bob",
            decidedAt: hoursAgo(1),
          },
        ]
      : [],
  });
}

async function mountProposals(api: FakeProposalsApi) {
  const wrapper = mount(MealProposals, {
    props: { mealId: MEAL, mealName: "Dinner", timeZone: "Asia/Tokyo", organiser: false },
    global: { provide: { [proposalsApiKey as symbol]: api } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

function nudgeSection(wrapper: VueWrapper) {
  return wrapper.get('[aria-label="Nudge"]');
}

function nudgeButton(wrapper: VueWrapper) {
  return nudgeSection(wrapper).get("button");
}

describe("nudging the people who have not voted", () => {
  test("says who has not voted, and offers to nudge them", async () => {
    const wrapper = await mountProposals(dinner());

    expect(nudgeSection(wrapper).text()).toContain("Carol and Frank haven't voted yet.");
    expect(nudgeButton(wrapper).text()).toBe("Nudge them");
    expect(nudgeButton(wrapper).element.disabled).toBe(false);
  });

  test("nudging says who it reached, then shows the full cooldown", async () => {
    const api = dinner();
    const wrapper = await mountProposals(api);

    await buttonByText(wrapper, "Nudge them").trigger("click");
    await flushPromises();

    expect(api.nudges).toEqual([{ mealId: MEAL, at: NOW }]);
    expect(wrapper.get('[role="status"]').text()).toBe("Nudged Carol and Frank by email.");
    expect(nudgeButton(wrapper).text()).toBe("Nudge again in 6 h");
    expect(nudgeButton(wrapper).element.disabled).toBe(true);
  });
});

describe("the cooldown", () => {
  test("during cooldown the button says how long is left, and why", async () => {
    const wrapper = await mountProposals(dinner({ lastNudged: hoursAgo(1.75) }));

    expect(nudgeButton(wrapper).text()).toBe("Nudge again in 4 h 15 min");
    expect(nudgeButton(wrapper).element.disabled).toBe(true);
    expect(nudgeSection(wrapper).text()).toContain("A meal can be nudged once every six hours.");
  });

  test("the time left counts down while the meal is open", async () => {
    const wrapper = await mountProposals(dinner({ lastNudged: hoursAgo(5) }));
    expect(nudgeButton(wrapper).text()).toBe("Nudge again in 1 h");

    await vi.advanceTimersByTimeAsync(40 * 60 * 1000);

    expect(nudgeButton(wrapper).text()).toBe("Nudge again in 20 min");
  });

  test("at exactly six hours it can be nudged again", async () => {
    const wrapper = await mountProposals(dinner({ lastNudged: hoursAgo(5) }));

    await vi.advanceTimersByTimeAsync(HOUR);

    expect(nudgeButton(wrapper).text()).toBe("Nudge them");
    expect(nudgeButton(wrapper).element.disabled).toBe(false);
  });

  test("a nudge someone else sent meanwhile is refused, and the cooldown shown", async () => {
    const api = dinner();
    const wrapper = await mountProposals(api);
    api.nudgeAs(MEAL, hoursAgo(0.5));

    await buttonByText(wrapper, "Nudge them").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(
      "Someone nudged this meal in the last six hours, so yours was not sent.",
    );
    expect(nudgeButton(wrapper).text()).toBe("Nudge again in 5 h 30 min");
  });
});

describe("when there is nobody to nudge", () => {
  test("a meal where everyone else has voted offers no nudge, and says why", async () => {
    const wrapper = await mountProposals(dinner({ everyoneVoted: true }));

    expect(nudgeSection(wrapper).text()).toBe(
      "Everyone else has voted, so there's nobody to nudge.",
    );
    expect(nudgeSection(wrapper).find("button").exists()).toBe(false);
  });

  test("nor does one where everyone has voted, even in cooldown", async () => {
    const wrapper = await mountProposals(dinner({ everyoneVoted: true, lastNudged: hoursAgo(1) }));

    expect(nudgeSection(wrapper).find("button").exists()).toBe(false);
  });

  test("a decided meal offers no nudge", async () => {
    const wrapper = await mountProposals(dinner({ decided: true }));

    expect(wrapper.find('[aria-label="Nudge"]').exists()).toBe(false);
  });

  test("a trip of one has nobody to nudge and says nothing about it", async () => {
    const api = createFakeProposalsApi({
      proposals: [aProposal({ mealId: MEAL, placeName: "Afuri" })],
    });
    const wrapper = await mountProposals(api);

    expect(wrapper.find('[aria-label="Nudge"]').exists()).toBe(false);
  });

  test("nor does a meal with nothing to vote on", async () => {
    const api = createFakeProposalsApi({ members: [bob] });
    const wrapper = await mountProposals(api);

    expect(wrapper.find('[aria-label="Nudge"]').exists()).toBe(false);
  });
});
