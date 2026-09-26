import { describe, expect, test } from "vite-plus/test";
import { netDecisionChange, type DecisionNotice } from "./decisionNotice.ts";

let nextId = 1;
function notice(
  from: [string, string] | null,
  to: [string, string] | null,
  actorId: string | null = "bob",
): DecisionNotice {
  return {
    id: nextId++,
    previousProposalId: from?.[0] ?? null,
    previousPlaceName: from?.[1] ?? null,
    proposalId: to?.[0] ?? null,
    placeName: to?.[1] ?? null,
    actorId,
  };
}

const ichiran: [string, string] = ["p-ichiran", "Ichiran"];
const afuri: [string, string] = ["p-afuri", "Afuri"];

describe("netDecisionChange", () => {
  test("a meal decided", () => {
    expect(netDecisionChange([notice(null, ichiran)])).toEqual({
      change: { kind: "decided", placeName: "Ichiran" },
      actorId: "bob",
    });
  });

  test("a decision changed says what it was before", () => {
    expect(netDecisionChange([notice(ichiran, afuri)])).toEqual({
      change: { kind: "changed", placeName: "Afuri", previousPlaceName: "Ichiran" },
      actorId: "bob",
    });
  });

  test("a decision cleared", () => {
    expect(netDecisionChange([notice(ichiran, null)])).toEqual({
      change: { kind: "cleared", previousPlaceName: "Ichiran" },
      actorId: "bob",
    });
  });

  test("several changes between two sends make one email, from first to last", () => {
    const changes = [
      notice(null, ichiran, "alice"),
      notice(ichiran, afuri, "alice"),
      notice(afuri, ichiran, "carol"),
      notice(ichiran, afuri, "carol"),
    ];

    expect(netDecisionChange(changes)).toEqual({
      change: { kind: "decided", placeName: "Afuri" },
      actorId: "carol",
    });
  });

  test("changes that end where they started send nothing", () => {
    expect(netDecisionChange([notice(null, ichiran), notice(ichiran, null)])).toBeNull();
    expect(netDecisionChange([notice(ichiran, afuri), notice(afuri, ichiran)])).toBeNull();
  });

  test("nothing to go on sends nothing", () => {
    expect(netDecisionChange([])).toBeNull();
  });

  test("the notices can arrive in any order", () => {
    const first = notice(null, ichiran, "alice");
    const second = notice(ichiran, afuri, "carol");

    expect(netDecisionChange([second, first])).toEqual({
      change: { kind: "decided", placeName: "Afuri" },
      actorId: "carol",
    });
  });
});
