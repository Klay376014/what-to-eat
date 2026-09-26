import { describe, expect, test } from "vite-plus/test";
import { emailRecipients, type TripMemberContact } from "./recipients.ts";

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
