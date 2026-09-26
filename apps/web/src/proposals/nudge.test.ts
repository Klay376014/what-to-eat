import { describe, expect, test } from "vite-plus/test";
import { aVote } from "../test/fakeProposalsApi.ts";
import { formatCooldown, nudgeCooldownLeft, nudgeOffer } from "./nudge.ts";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const nudgedAt = "2026-10-02T09:00:00.000Z";
const after = (ms: number) => new Date(Date.parse(nudgedAt) + ms);

describe("nudgeCooldownLeft", () => {
  test("a meal never nudged can be nudged now", () => {
    expect(nudgeCooldownLeft(null, after(0))).toBe(0);
  });

  test("straight after a nudge, the full six hours are left", () => {
    expect(nudgeCooldownLeft(nudgedAt, after(0))).toBe(6 * HOUR);
  });

  test("part way through, what is left of the six hours", () => {
    expect(nudgeCooldownLeft(nudgedAt, after(4 * HOUR + 15 * MINUTE))).toBe(1 * HOUR + 45 * MINUTE);
  });

  test("one millisecond short of six hours, it is still cooling down", () => {
    expect(nudgeCooldownLeft(nudgedAt, after(6 * HOUR - 1))).toBe(1);
  });

  test("at exactly six hours, it can be nudged again", () => {
    expect(nudgeCooldownLeft(nudgedAt, after(6 * HOUR))).toBe(0);
  });

  test("long after, nothing is left", () => {
    expect(nudgeCooldownLeft(nudgedAt, after(30 * HOUR))).toBe(0);
  });

  test("a nudge stamped slightly ahead of this device's clock never shows more than six hours", () => {
    expect(nudgeCooldownLeft(nudgedAt, after(-2 * MINUTE))).toBe(6 * HOUR);
  });
});

describe("formatCooldown", () => {
  test("hours and minutes", () => {
    expect(formatCooldown(5 * HOUR + 12 * MINUTE)).toBe("5 h 12 min");
  });

  test("whole hours drop the minutes", () => {
    expect(formatCooldown(6 * HOUR)).toBe("6 h");
  });

  test("under an hour, minutes only", () => {
    expect(formatCooldown(42 * MINUTE)).toBe("42 min");
  });

  test("a part minute counts as a whole one, so it never says 0 while still waiting", () => {
    expect(formatCooldown(30 * 1000)).toBe("1 min");
    expect(formatCooldown(59 * MINUTE + 1)).toBe("1 h");
  });
});

describe("nudgeOffer", () => {
  const me = { userId: "me", name: "Mei" };
  const bob = { userId: "bob", name: "Bob" };
  const carol = { userId: "carol", name: "Carol" };
  const proposals = [
    { votes: [aVote({ voterId: "bob", value: 1 })] },
    { votes: [] as ReturnType<typeof aVote>[] },
  ];
  const base = {
    decided: false,
    proposals,
    members: [me, bob, carol],
    meId: "me",
    lastNudgedAt: null,
    now: after(0),
  };

  test("offered, naming who has not voted, without the person nudging", () => {
    expect(nudgeOffer(base)).toEqual({ kind: "ready", waiting: [carol] });
  });

  test("in cooldown it says how long is left, and still who it would reach", () => {
    expect(nudgeOffer({ ...base, lastNudgedAt: nudgedAt, now: after(2 * HOUR) })).toEqual({
      kind: "cooldown",
      remainingMs: 4 * HOUR,
      waiting: [carol],
    });
  });

  test("offered again at exactly six hours", () => {
    expect(nudgeOffer({ ...base, lastNudgedAt: nudgedAt, now: after(6 * HOUR) })).toEqual({
      kind: "ready",
      waiting: [carol],
    });
  });

  test("not offered when everyone else has voted", () => {
    const allVoted = [
      { votes: [aVote({ voterId: "bob", value: 1 }), aVote({ voterId: "carol", value: -1 })] },
    ];
    expect(nudgeOffer({ ...base, proposals: allVoted })).toEqual({
      kind: "unavailable",
      reason: "everyone-voted",
    });
  });

  test("everyone else having voted is still nothing to nudge in cooldown", () => {
    const allVoted = [
      { votes: [aVote({ voterId: "bob", value: 1 }), aVote({ voterId: "carol", value: -1 })] },
    ];
    expect(
      nudgeOffer({ ...base, proposals: allVoted, lastNudgedAt: nudgedAt, now: after(HOUR) }),
    ).toEqual({ kind: "unavailable", reason: "everyone-voted" });
  });

  test("not offered on a decided meal", () => {
    expect(nudgeOffer({ ...base, decided: true })).toEqual({
      kind: "unavailable",
      reason: "decided",
    });
  });

  test("not offered while there is nothing to vote on", () => {
    expect(nudgeOffer({ ...base, proposals: [] })).toEqual({
      kind: "unavailable",
      reason: "no-proposals",
    });
  });
});
