import { describe, expect, test } from "vite-plus/test";
import {
  explainJoinFailure,
  invitationStatus,
  inviteUrl,
  locationWithoutInvite,
  readInviteToken,
  timeLeft,
} from "./invitation.ts";

const token = "Q2hlY2sgdGhhdCB0aGlzIGlzIDQzIGNoYXJhY3RlcnM";

describe("reading the invitation from the address", () => {
  test("finds the token in ?invite=", () => {
    expect(readInviteToken(`?invite=${token}`)).toBe(token);
  });

  test("finds it next to other parameters", () => {
    expect(readInviteToken(`?day=2026-10-03&invite=${token}`)).toBe(token);
  });

  test("an address without one has none", () => {
    expect(readInviteToken("")).toBeNull();
    expect(readInviteToken("?day=2026-10-03")).toBeNull();
  });

  test("an empty or blank value is no invitation", () => {
    expect(readInviteToken("?invite=")).toBeNull();
    expect(readInviteToken("?invite=%20%20")).toBeNull();
  });

  test("a mangled value is kept, so the database can say it is not valid", () => {
    // Chat apps sometimes cut a link short; the person should hear that the
    // link is not valid rather than land on their trips as if nothing happened.
    expect(readInviteToken("?invite=Q2hlY2sgdGhh")).toBe("Q2hlY2sgdGhh");
  });

  test("surrounding whitespace from a sloppy paste is dropped", () => {
    expect(readInviteToken(`?invite=%20${token}%0A`)).toBe(token);
  });
});

describe("taking the invitation out of the address", () => {
  test("removes only the invitation, keeping the rest", () => {
    expect(locationWithoutInvite("/", `?day=2026-10-03&invite=${token}`, "#top")).toBe(
      "/?day=2026-10-03#top",
    );
  });

  test("leaves a bare path when it was the only parameter", () => {
    expect(locationWithoutInvite("/what-to-eat/", `?invite=${token}`, "")).toBe("/what-to-eat/");
  });
});

describe("the link an organiser shares", () => {
  test("points at the app with the token as ?invite=", () => {
    expect(inviteUrl(token, "https://example.com/")).toBe(`https://example.com/?invite=${token}`);
  });

  test("keeps the path the app is served from", () => {
    expect(inviteUrl(token, "https://klay376014.github.io/what-to-eat/")).toBe(
      `https://klay376014.github.io/what-to-eat/?invite=${token}`,
    );
  });

  test("round-trips through reading it back", () => {
    const url = new URL(inviteUrl(token, "https://example.com/"));
    expect(readInviteToken(url.search)).toBe(token);
  });
});

describe("whether a link still works", () => {
  const issued = {
    createdAt: "2026-10-01T00:00:00Z",
    expiresAt: "2026-10-08T00:00:00Z",
    revokedAt: null,
  };

  test("works until it expires", () => {
    expect(invitationStatus(issued, new Date("2026-10-07T23:59:59Z"))).toBe("active");
  });

  test("stops working at its expiry", () => {
    expect(invitationStatus(issued, new Date("2026-10-08T00:00:00Z"))).toBe("expired");
  });

  test("stops working once revoked, even before it would expire", () => {
    const revoked = { ...issued, revokedAt: "2026-10-02T00:00:00Z" };
    expect(invitationStatus(revoked, new Date("2026-10-03T00:00:00Z"))).toBe("revoked");
  });
});

describe("how long a link has left", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

  test("counts whole days, rounding down", () => {
    expect(timeLeft(at(7 * 24), now)).toBe("7 days");
    expect(timeLeft(at(2 * 24 + 23), now)).toBe("2 days");
    expect(timeLeft(at(47), now)).toBe("1 day");
  });

  test("counts hours on the last day", () => {
    expect(timeLeft(at(23.5), now)).toBe("23 hours");
    expect(timeLeft(at(1.5), now)).toBe("1 hour");
    expect(timeLeft(at(0.5), now)).toBe("less than an hour");
  });
});

describe("explaining a link that did not work", () => {
  test("every reason says what happened and what to do next", () => {
    for (const reason of [
      "expired",
      "revoked",
      "invalid",
      "full",
      "predates_departure",
      "unknown",
    ] as const) {
      const { title, body } = explainJoinFailure(reason);
      expect(title.length).toBeGreaterThan(0);
      expect(body).toMatch(/organiser/i);
    }
  });

  test("an expired link says links last 7 days", () => {
    expect(explainJoinFailure("expired").body).toMatch(/7 days/);
  });

  test("a full trip says why the limit exists", () => {
    const { body } = explainJoinFailure("full");
    expect(body).toMatch(/8 people/);
    expect(body).toMatch(/vot/i);
  });
});
