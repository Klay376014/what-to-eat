import { describe, expect, test } from "vite-plus/test";
import type { DigestMeal, DigestProposal } from "./digest.ts";
import { decisionEmail, digestEmail, mealLink } from "./emails.ts";

const APP = "https://klay376014.github.io/what-to-eat/";
const trip = { id: "trip-1", name: "Tokyo <3", timezone: "Asia/Tokyo" };

function aProposal(
  overrides: Partial<DigestProposal> & Pick<DigestProposal, "id">,
): DigestProposal {
  return {
    placeName: "Ichiran",
    proposedBy: "alice",
    proposerName: "Alice Chen",
    createdAt: "2026-10-02T12:00:00Z",
    voterIds: [],
    ...overrides,
  };
}

const dinner: DigestMeal = {
  id: "meal-dinner",
  date: "2026-10-03",
  slot: "dinner",
  label: null,
  position: 1,
  startTime: null,
  decided: false,
  proposals: [],
};

const tea: DigestMeal = { ...dinner, id: "meal-tea", slot: "other", label: "Tea & cake" };

describe("mealLink", () => {
  test("opens the trip on the meal's day, at the meal", () => {
    const link = new URL(mealLink(APP, trip.id, dinner));

    expect(link.origin + link.pathname).toBe(APP);
    expect(link.searchParams.get("trip")).toBe("trip-1");
    expect(link.searchParams.get("day")).toBe("2026-10-03");
    expect(link.searchParams.get("meal")).toBe("meal-dinner");
  });
});

describe("digestEmail", () => {
  const digest = {
    newProposals: [
      { meal: dinner, proposals: [aProposal({ id: "p1", placeName: "Ichiran <Shibuya>" })] },
    ],
    awaitingVote: [tea],
  };

  test("the subject names the trip and says what is waiting", () => {
    const email = digestEmail({ appUrl: APP, trip, day: "2026-10-03", digest });

    expect(email.subject).toBe("Tokyo <3: 1 new proposal, 1 meal awaiting your vote");
  });

  test("with nothing awaiting a vote, the subject says only what is new", () => {
    const email = digestEmail({
      appUrl: APP,
      trip,
      day: "2026-10-03",
      digest: {
        newProposals: [
          { meal: dinner, proposals: [aProposal({ id: "a" }), aProposal({ id: "b" })] },
        ],
        awaitingVote: [],
      },
    });

    expect(email.subject).toBe("Tokyo <3: 2 new proposals");
  });

  test("names each new proposal, who made it, and the meal it is for", () => {
    const email = digestEmail({ appUrl: APP, trip, day: "2026-10-03", digest });

    expect(email.text).toContain("Dinner, Sat 3 Oct");
    expect(email.text).toContain("Ichiran <Shibuya> (Alice Chen)");
    expect(email.text).toContain("Tea & cake, Sat 3 Oct");
  });

  test("links every meal straight to itself", () => {
    const email = digestEmail({ appUrl: APP, trip, day: "2026-10-03", digest });

    for (const meal of [dinner, tea]) {
      expect(email.text).toContain(mealLink(APP, trip.id, meal));
      expect(email.html).toContain(escapeAttr(mealLink(APP, trip.id, meal)));
    }
  });

  test("what members typed cannot become markup", () => {
    const email = digestEmail({ appUrl: APP, trip, day: "2026-10-03", digest });

    expect(email.html).not.toContain("<Shibuya>");
    expect(email.html).toContain("Ichiran &lt;Shibuya&gt;");
    expect(email.html).toContain("Tokyo &lt;3");
    expect(email.html).toContain("Tea &amp; cake");
  });

  test("is laid out for a phone: scaled to the screen, one narrow column", () => {
    const email = digestEmail({ appUrl: APP, trip, day: "2026-10-03", digest });

    expect(email.html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(email.html).toMatch(/max-width:\s*560px/);
  });
});

describe("decisionEmail", () => {
  const base = { appUrl: APP, trip, meal: dinner, actorName: "Bob Lin" };

  test("a new decision names the trip, the meal and the restaurant", () => {
    const email = decisionEmail({ ...base, change: { kind: "decided", placeName: "Ichiran" } });

    expect(email.subject).toBe("Tokyo <3: Dinner, Sat 3 Oct is Ichiran");
    expect(email.text).toContain("Bob Lin decided on Ichiran for Dinner, Sat 3 Oct at 19:00.");
  });

  test("a changed decision says what it was before", () => {
    const email = decisionEmail({
      ...base,
      change: { kind: "changed", placeName: "Afuri", previousPlaceName: "Ichiran" },
    });

    expect(email.subject).toBe("Tokyo <3: Dinner, Sat 3 Oct is now Afuri");
    expect(email.text).toContain(
      "Bob Lin changed Dinner, Sat 3 Oct at 19:00 from Ichiran to Afuri.",
    );
  });

  test("a cleared decision warns the plan is open again", () => {
    const email = decisionEmail({
      ...base,
      change: { kind: "cleared", previousPlaceName: "Ichiran" },
    });

    expect(email.subject).toBe("Tokyo <3: Dinner, Sat 3 Oct is undecided again");
    expect(email.text).toContain("Bob Lin cleared Ichiran from Dinner, Sat 3 Oct at 19:00");
  });

  test("the time shown is the meal's own, on the trip's clock", () => {
    const email = decisionEmail({
      ...base,
      meal: { ...dinner, startTime: "18:30:00" },
      change: { kind: "decided", placeName: "Ichiran" },
    });

    expect(email.text).toContain("at 18:30");
  });

  test("links straight to the meal", () => {
    const email = decisionEmail({ ...base, change: { kind: "decided", placeName: "Ichiran" } });

    expect(email.text).toContain(mealLink(APP, trip.id, dinner));
    expect(email.html).toContain(escapeAttr(mealLink(APP, trip.id, dinner)));
  });

  test("someone whose account is gone is 'a member'", () => {
    const email = decisionEmail({
      ...base,
      actorName: null,
      change: { kind: "decided", placeName: "Ichiran" },
    });

    expect(email.text).toContain("A member decided on Ichiran");
  });
});

function escapeAttr(value: string): string {
  return value.replaceAll("&", "&amp;");
}
