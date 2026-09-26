import { describe, expect, test } from "vite-plus/test";
import { emailRecipients, nudgeRecipients, type TripMemberContact } from "./recipients.ts";

function aMember(overrides: Partial<TripMemberContact> & Pick<TripMemberContact, "userId">) {
  return {
    email: `${overrides.userId}@example.com`,
    name: null,
    leftAt: null,
    ...overrides,
  };
}

describe("emailRecipients", () => {
  test("every current member of the trip", () => {
    const alice = aMember({ userId: "alice" });
    const bob = aMember({ userId: "bob" });

    expect(emailRecipients([alice, bob])).toEqual([alice, bob]);
  });

  test("members who have left the trip are not emailed", () => {
    const alice = aMember({ userId: "alice" });
    const dave = aMember({ userId: "dave", leftAt: "2026-10-01T00:00:00Z" });

    expect(emailRecipients([alice, dave])).toEqual([alice]);
  });

  test("a member with no email address on their account is skipped", () => {
    const alice = aMember({ userId: "alice" });
    const ghost = aMember({ userId: "ghost", email: null });

    expect(emailRecipients([alice, ghost])).toEqual([alice]);
  });

  test("the person who acted can be left out of their own notification", () => {
    const alice = aMember({ userId: "alice" });
    const bob = aMember({ userId: "bob" });

    expect(emailRecipients([alice, bob], { except: "alice" })).toEqual([bob]);
  });

  test("the same person listed twice is emailed once", () => {
    const alice = aMember({ userId: "alice" });

    expect(emailRecipients([alice, { ...alice }])).toEqual([alice]);
  });
});

describe("nudgeRecipients", () => {
  // Who a nudge on a meal reaches (#16): current members with no vote on any
  // of its proposals, less the person nudging.
  const alice = aMember({ userId: "alice" });
  const bob = aMember({ userId: "bob" });
  const carol = aMember({ userId: "carol" });
  const dave = aMember({ userId: "dave", leftAt: "2026-10-01T00:00:00Z" });

  test("with partial voting, only those with no vote on any proposal", () => {
    const proposals = [{ voterIds: ["bob"] }, { voterIds: [] }];

    expect(nudgeRecipients([alice, bob, carol], proposals, "alice")).toEqual([carol]);
  });

  test("one vote on any of the meal's proposals counts, for or against", () => {
    const proposals = [{ voterIds: ["bob"] }, { voterIds: ["carol"] }];

    expect(nudgeRecipients([alice, bob, carol], proposals, "alice")).toEqual([]);
  });

  test("the person nudging is never nudged, even with no vote of their own", () => {
    expect(nudgeRecipients([alice, bob], [{ voterIds: [] }], "alice")).toEqual([bob]);
  });

  test("members who have left are not nudged, though they never voted", () => {
    expect(nudgeRecipients([alice, bob, dave], [{ voterIds: [] }], "alice")).toEqual([bob]);
  });

  test("a departed member's vote stays on the proposal but stands in for nobody", () => {
    const proposals = [{ voterIds: ["dave"] }];

    expect(nudgeRecipients([alice, bob, carol, dave], proposals, "alice")).toEqual([bob, carol]);
  });

  test("a member with no address cannot be emailed", () => {
    const ghost = aMember({ userId: "ghost", email: null });

    expect(nudgeRecipients([alice, bob, ghost], [{ voterIds: [] }], "alice")).toEqual([bob]);
  });

  test("a nudger whose account is gone leaves out nobody", () => {
    expect(nudgeRecipients([alice, bob], [{ voterIds: ["bob"] }], null)).toEqual([alice]);
  });
});
