import { describe, expect, test } from "vite-plus/test";
import { digestFor, type DigestMeal, type DigestProposal } from "./digest.ts";

const ME = "me";

function aProposal(
  overrides: Partial<DigestProposal> & Pick<DigestProposal, "id">,
): DigestProposal {
  return {
    placeName: `Place ${overrides.id}`,
    proposedBy: "alice",
    proposerName: "Alice Chen",
    createdAt: "2026-10-02T12:00:00Z",
    voterIds: [],
    ...overrides,
  };
}

function aMeal(overrides: Partial<DigestMeal> & Pick<DigestMeal, "id">): DigestMeal {
  return {
    date: "2026-10-03",
    slot: "dinner",
    label: null,
    position: 1,
    startTime: null,
    decided: false,
    proposals: [],
    ...overrides,
  };
}

// The digest for Sat 3 Oct, cut at 08:00 Tokyo; the last one was cut 24 hours before.
const window = {
  recipientId: ME,
  today: "2026-10-03",
  since: new Date("2026-10-01T23:00:00Z"),
  until: new Date("2026-10-02T23:00:00Z"),
};

describe("digestFor", () => {
  test("lists the proposals made since the last digest", () => {
    const fresh = aProposal({ id: "fresh", createdAt: "2026-10-02T12:00:00Z" });
    const old = aProposal({ id: "old", createdAt: "2026-10-01T22:59:59Z" });
    const dinner = aMeal({ id: "dinner", proposals: [old, fresh] });

    const digest = digestFor({ ...window, meals: [dinner] });

    expect(digest?.newProposals).toEqual([{ meal: dinner, proposals: [fresh] }]);
  });

  test("a proposal made after the cut-off waits for tomorrow's digest", () => {
    const late = aProposal({ id: "late", createdAt: "2026-10-02T23:00:00Z" });
    const onTime = aProposal({ id: "on-time", createdAt: "2026-10-01T23:00:00Z" });
    const dinner = aMeal({ id: "dinner", proposals: [late, onTime] });

    const digest = digestFor({ ...window, meals: [dinner] });

    expect(digest?.newProposals).toEqual([{ meal: dinner, proposals: [onTime] }]);
  });

  test("the first digest of a trip counts every proposal as new", () => {
    const ancient = aProposal({ id: "ancient", createdAt: "2026-01-01T00:00:00Z" });
    const dinner = aMeal({ id: "dinner", proposals: [ancient] });

    const digest = digestFor({ ...window, since: null, meals: [dinner] });

    expect(digest?.newProposals).toEqual([{ meal: dinner, proposals: [ancient] }]);
  });

  test("nothing new since the last digest sends nothing, even with meals awaiting a vote", () => {
    const old = aProposal({ id: "old", createdAt: "2026-09-30T00:00:00Z" });
    const dinner = aMeal({ id: "dinner", proposals: [old] });

    expect(digestFor({ ...window, meals: [dinner] })).toBeNull();
  });

  test("your own proposals are not news to you", () => {
    const mine = aProposal({ id: "mine", proposedBy: ME });
    const dinner = aMeal({ id: "dinner", proposals: [mine] });

    expect(digestFor({ ...window, meals: [dinner] })).toBeNull();
  });

  test("a departed member's new proposal is still news", () => {
    // Nothing about a proposal records whether its author is still in the trip.
    const theirs = aProposal({ id: "theirs", proposedBy: "dave", proposerName: "Dave Ho" });
    const dinner = aMeal({ id: "dinner", proposals: [theirs] });

    expect(digestFor({ ...window, meals: [dinner] })?.newProposals).toHaveLength(1);
  });

  test("lists the meals still awaiting your vote, new proposals or not", () => {
    const lunch = aMeal({
      id: "lunch",
      slot: "lunch",
      proposals: [aProposal({ id: "old", createdAt: "2026-09-30T00:00:00Z" })],
    });
    const dinner = aMeal({ id: "dinner", proposals: [aProposal({ id: "fresh" })] });

    const digest = digestFor({ ...window, meals: [dinner, lunch] });

    expect(digest?.awaitingVote).toEqual([lunch, dinner]);
  });

  test("a meal you have voted on, either way, on any proposal, is not awaiting you", () => {
    const dinner = aMeal({
      id: "dinner",
      proposals: [aProposal({ id: "a" }), aProposal({ id: "b", voterIds: ["bob", ME] })],
    });

    expect(digestFor({ ...window, meals: [dinner] })?.awaitingVote).toEqual([]);
  });

  test("a decided meal is not awaiting anyone's vote", () => {
    const dinner = aMeal({ id: "dinner", decided: true, proposals: [aProposal({ id: "a" })] });

    expect(digestFor({ ...window, meals: [dinner] })?.awaitingVote).toEqual([]);
  });

  test("a meal with nothing proposed has nothing to vote on", () => {
    const lunch = aMeal({ id: "lunch", slot: "lunch" });
    const dinner = aMeal({ id: "dinner", proposals: [aProposal({ id: "a" })] });

    expect(digestFor({ ...window, meals: [lunch, dinner] })?.awaitingVote).toEqual([dinner]);
  });

  test("meals on days already gone are left out", () => {
    const yesterday = aMeal({
      id: "yesterday",
      date: "2026-10-02",
      proposals: [aProposal({ id: "a" })],
    });
    const today = aMeal({ id: "today", proposals: [aProposal({ id: "b" })] });

    const digest = digestFor({ ...window, meals: [yesterday, today] });

    expect(digest?.newProposals.map((n) => n.meal)).toEqual([today]);
    expect(digest?.awaitingVote).toEqual([today]);
  });

  test("meals are listed in the order they happen", () => {
    const p = () => aProposal({ id: crypto.randomUUID() });
    const sundayBreakfast = aMeal({
      id: "sun-breakfast",
      date: "2026-10-04",
      slot: "breakfast",
      proposals: [p()],
    });
    const lateLunch = aMeal({
      id: "late-lunch",
      slot: "lunch",
      startTime: "20:30:00",
      proposals: [p()],
    });
    const tea = aMeal({ id: "tea", slot: "other", label: "Tea", position: 7, proposals: [p()] });
    const dinner = aMeal({ id: "dinner", proposals: [p()] });

    const digest = digestFor({ ...window, meals: [sundayBreakfast, lateLunch, dinner, tea] });

    expect(digest?.awaitingVote.map((m) => m.id)).toEqual([
      "tea",
      "dinner",
      "late-lunch",
      "sun-breakfast",
    ]);
    expect(digest?.newProposals.map((n) => n.meal.id)).toEqual([
      "tea",
      "dinner",
      "late-lunch",
      "sun-breakfast",
    ]);
  });
});
