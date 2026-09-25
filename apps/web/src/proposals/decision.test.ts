import { describe, expect, test } from "vite-plus/test";
import { canChangeDecision, deciderLabel, type Decision } from "./decision.ts";

function aDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    mealId: "meal",
    proposalId: "proposal",
    decidedBy: "alice",
    decidedByMe: false,
    deciderName: "Alice Chen",
    decidedAt: "2026-09-24T02:00:00Z",
    ...overrides,
  };
}

describe("canChangeDecision", () => {
  // Changing is held to a higher bar than deciding (#11): any member decides,
  // only the decider or the organiser changes or clears.
  test("the member who decided may change it", () => {
    expect(canChangeDecision(aDecision({ decidedByMe: true }), { organiser: false })).toBe(true);
  });

  test("the organiser may change anyone's decision", () => {
    expect(canChangeDecision(aDecision(), { organiser: true })).toBe(true);
  });

  test("any other member may not", () => {
    expect(canChangeDecision(aDecision(), { organiser: false })).toBe(false);
  });

  test("once the decider's account is gone, only the organiser may", () => {
    const orphaned = aDecision({ decidedBy: null, deciderName: null });
    expect(canChangeDecision(orphaned, { organiser: false })).toBe(false);
    expect(canChangeDecision(orphaned, { organiser: true })).toBe(true);
  });
});

describe("deciderLabel", () => {
  test("says who decided, as 'Decided by <this>'", () => {
    expect(deciderLabel(aDecision({ decidedByMe: true }))).toBe("you");
    expect(deciderLabel(aDecision())).toBe("Alice Chen");
    expect(deciderLabel(aDecision({ deciderName: null }))).toBe("a member with no name");
    expect(deciderLabel(aDecision({ decidedBy: null, deciderName: null }))).toBe(
      "a member who deleted their account",
    );
  });
});
