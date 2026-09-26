import { describe, expect, test } from "vite-plus/test";
import { composeDecisionEmails, composeDigests, composeNudgeEmails } from "./compose.ts";
import type { DigestMeal } from "./digest.ts";
import type { DecisionNotice } from "./decisionNotice.ts";
import type { TripMemberContact } from "./recipients.ts";

const APP = "https://klay376014.github.io/what-to-eat/app/";
const tokyo = { id: "tokyo", name: "Tokyo", timezone: "Asia/Tokyo" };
const osaka = { id: "osaka", name: "Osaka", timezone: "Asia/Tokyo" };

function member(userId: string, more: Partial<TripMemberContact> = {}): TripMemberContact {
  return {
    userId,
    email: `${userId}@example.com`,
    name: userId.toUpperCase(),
    leftAt: null,
    ...more,
  };
}

const alice = member("alice");
const bob = member("bob");
const carol = member("carol");
const dave = member("dave", { leftAt: "2026-10-01T00:00:00Z" });

function dinnerWith(proposedBy: string, voterIds: string[] = []): DigestMeal {
  return {
    id: "dinner",
    date: "2026-10-03",
    slot: "dinner",
    label: null,
    position: 1,
    startTime: null,
    decided: false,
    proposals: [
      {
        id: "p1",
        placeName: "Ichiran",
        proposedBy,
        proposerName: proposedBy.toUpperCase(),
        createdAt: "2026-10-02T12:00:00Z",
        voterIds,
      },
    ],
  };
}

const window = {
  appUrl: APP,
  day: "2026-10-03",
  since: new Date("2026-10-01T23:00:00Z"),
  until: new Date("2026-10-02T23:00:00Z"),
};

describe("composeDigests", () => {
  test("one digest per current member with something new", () => {
    const emails = composeDigests({
      ...window,
      trip: tokyo,
      meals: [dinnerWith("alice")],
      members: [alice, bob, carol, dave],
    });

    // Alice proposed it (not news to her); Dave has left.
    expect(emails.map((e) => e.recipientId)).toEqual(["bob", "carol"]);
    expect(emails.every((e) => e.subject.startsWith("Tokyo:"))).toBe(true);
  });

  test("a trip with nothing new sends no email at all", () => {
    const emails = composeDigests({
      ...window,
      since: new Date("2026-10-02T13:00:00Z"),
      trip: tokyo,
      meals: [dinnerWith("alice")],
      members: [alice, bob, carol],
    });

    expect(emails).toEqual([]);
  });

  test("a member in two trips gets one digest for each, each naming its trip", () => {
    const members = [alice, bob];
    const fromTokyo = composeDigests({
      ...window,
      trip: tokyo,
      meals: [dinnerWith("alice")],
      members,
    });
    const fromOsaka = composeDigests({
      ...window,
      trip: osaka,
      meals: [dinnerWith("alice")],
      members,
    });

    const bobs = [...fromTokyo, ...fromOsaka].filter((e) => e.recipientId === "bob");
    expect(bobs.map((e) => e.subject.split(":")[0])).toEqual(["Tokyo", "Osaka"]);
    expect(new Set(bobs.map((e) => e.dedupeKey)).size).toBe(2);
  });

  test("the same digest composed twice has the same keys, so a retry cannot send it twice", () => {
    const input = { ...window, trip: tokyo, meals: [dinnerWith("alice")], members: [alice, bob] };

    expect(composeDigests(input).map((e) => e.dedupeKey)).toEqual(
      composeDigests(input).map((e) => e.dedupeKey),
    );
    expect(composeDigests(input)[0]!.dedupeKey).toBe("digest:tokyo:2026-10-03:bob");
  });

  test("each digest says what awaits that member's vote", () => {
    const emails = composeDigests({
      ...window,
      trip: tokyo,
      meals: [dinnerWith("alice", ["bob"])],
      members: [alice, bob, carol],
    });

    const subjectFor = (id: string) => emails.find((e) => e.recipientId === id)?.subject;
    expect(subjectFor("bob")).toBe("Tokyo: 1 new proposal");
    expect(subjectFor("carol")).toBe("Tokyo: 1 new proposal, 1 meal awaiting your vote");
  });
});

describe("composeDecisionEmails", () => {
  const meal = {
    id: "dinner",
    date: "2026-10-03",
    slot: "dinner" as const,
    label: null,
    startTime: null,
  };
  const decided: DecisionNotice = {
    id: 41,
    previousProposalId: null,
    previousPlaceName: null,
    proposalId: "p1",
    placeName: "Ichiran",
    actorId: "alice",
  };

  test("every current member but the one who decided is told", () => {
    const emails = composeDecisionEmails({
      appUrl: APP,
      trip: tokyo,
      meal,
      notices: [decided],
      members: [alice, bob, carol, dave],
    });

    expect(emails.map((e) => e.recipientId)).toEqual(["bob", "carol"]);
    expect(emails[0]!.subject).toBe("Tokyo: Dinner, Sat 3 Oct is Ichiran");
    expect(emails[0]!.text).toContain("ALICE decided on Ichiran");
  });

  test("a member who opted out of calendar invitations still gets it", () => {
    // Opting out of being a calendar guest (#14) is not recorded on the
    // contacts at all: the app's own email goes to every current member.
    const emails = composeDecisionEmails({
      appUrl: APP,
      trip: tokyo,
      meal,
      notices: [decided],
      members: [alice, bob],
    });

    expect(emails.map((e) => e.recipientId)).toEqual(["bob"]);
  });

  test("a decider who has since left is still named", () => {
    const emails = composeDecisionEmails({
      appUrl: APP,
      trip: tokyo,
      meal,
      notices: [{ ...decided, actorId: "dave" }],
      members: [alice, dave],
    });

    expect(emails.map((e) => e.recipientId)).toEqual(["alice"]);
    expect(emails[0]!.text).toContain("DAVE decided");
  });

  test("keys follow the last notice, so recomposing after a crash makes the same emails", () => {
    const later: DecisionNotice = {
      ...decided,
      id: 42,
      previousProposalId: "p1",
      previousPlaceName: "Ichiran",
      proposalId: null,
      placeName: null,
      actorId: "bob",
    };
    // Decided and cleared again before anything was sent: nobody is told.
    const undone = composeDecisionEmails({
      appUrl: APP,
      trip: tokyo,
      meal,
      notices: [decided, later],
      members: [alice, bob],
    });
    expect(undone).toEqual([]);

    const cleared = composeDecisionEmails({
      appUrl: APP,
      trip: tokyo,
      meal,
      notices: [later],
      members: [alice, bob],
    });
    expect(cleared.map((e) => e.dedupeKey)).toEqual(["decision:42:alice"]);
    expect(cleared[0]!.subject).toBe("Tokyo: Dinner, Sat 3 Oct is undecided again");
  });
});

describe("composeNudgeEmails", () => {
  const meal = {
    id: "dinner",
    date: "2026-10-03",
    slot: "dinner" as const,
    label: null,
    startTime: null,
  };
  const base = {
    appUrl: APP,
    trip: tokyo,
    meal,
    nudge: { id: 7, nudgedBy: "alice" },
    decided: false,
    proposals: [
      { placeName: "Ichiran", voterIds: ["bob", "dave"] },
      { placeName: "Afuri", voterIds: [] },
    ],
    members: [alice, bob, carol, dave],
  };

  test("only current members with no vote, never the nudger, each under the nudge's key", () => {
    const emails = composeNudgeEmails(base);

    expect(emails.map((e) => [e.recipientId, e.dedupeKey])).toEqual([["carol", "nudge:7:carol"]]);
    expect(emails[0]!.subject).toBe("Tokyo: your vote on Dinner, Sat 3 Oct");
    expect(emails[0]!.text).toContain("ALICE asked for your vote");
  });

  test("a meal decided since the nudge sends nothing", () => {
    expect(composeNudgeEmails({ ...base, decided: true })).toEqual([]);
  });

  test("the same nudge composed twice has the same keys, so a retry cannot send it twice", () => {
    expect(composeNudgeEmails(base).map((e) => e.dedupeKey)).toEqual(
      composeNudgeEmails(base).map((e) => e.dedupeKey),
    );
  });
});
