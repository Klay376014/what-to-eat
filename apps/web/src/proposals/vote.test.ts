import { describe, expect, test } from "vite-plus/test";
import { membersWithoutVote, myVote, tally, unvotedByMe, voterLabel, type Vote } from "./vote.ts";

function aVote(overrides: Partial<Vote> & Pick<Vote, "voterId" | "value">): Vote {
  return {
    voterName: `Name of ${overrides.voterId}`,
    voterAvatarUrl: null,
    isMe: false,
    ...overrides,
  };
}

describe("tally", () => {
  test("no votes is nothing either way", () => {
    expect(tally([])).toEqual({ for: [], against: [] });
  });

  test("splits the votes by which way they went", () => {
    const alice = aVote({ voterId: "alice", voterName: "Alice Chen", value: 1 });
    const bob = aVote({ voterId: "bob", voterName: "Bob Lin", value: -1 });
    const carol = aVote({ voterId: "carol", voterName: "Carol Wu", value: 1 });

    expect(tally([alice, bob, carol])).toEqual({ for: [alice, carol], against: [bob] });
  });

  test("a member who left the trip still counts, under their name", () => {
    // Votes carry no membership: leaving the trip keeps the vote (#10), so
    // the tally behind a decision never changes when someone drops out.
    const current = aVote({ voterId: "alice", voterName: "Alice Chen", value: 1 });
    const departed = aVote({ voterId: "dave", voterName: "Dave Ho", value: 1 });

    const { for: supporters } = tally([current, departed]);

    expect(supporters).toHaveLength(2);
    expect(supporters.map(voterLabel)).toEqual(["Alice Chen", "Dave Ho"]);
  });

  test("a member who has not voted is not counted at all: no vote is no opinion", () => {
    const { for: supporters, against } = tally([
      aVote({ voterId: "alice", voterName: "Alice Chen", value: 1 }),
    ]);

    expect(supporters.length + against.length).toBe(1);
  });

  test("you come first, then everyone else by name, nameless last", () => {
    const zoe = aVote({ voterId: "zoe", voterName: "Zoe Tan", value: 1 });
    const nameless = aVote({ voterId: "anon", voterName: null, value: 1 });
    const me = aVote({ voterId: "me", voterName: "Mei Lin", isMe: true, value: 1 });
    const amy = aVote({ voterId: "amy", voterName: "Amy Ko", value: 1 });

    expect(tally([zoe, nameless, me, amy]).for).toEqual([me, amy, zoe, nameless]);
  });
});

describe("voterLabel", () => {
  test("you are 'you', others by name, and a missing name is said plainly", () => {
    expect(voterLabel(aVote({ voterId: "me", isMe: true, value: 1 }))).toBe("you");
    expect(voterLabel(aVote({ voterId: "a", voterName: "Alice Chen", value: 1 }))).toBe(
      "Alice Chen",
    );
    expect(voterLabel(aVote({ voterId: "b", voterName: null, value: -1 }))).toBe(
      "a member with no name",
    );
  });
});

describe("myVote", () => {
  test("is your vote's value, or null when you have not voted", () => {
    expect(myVote([aVote({ voterId: "a", value: 1 })])).toBeNull();
    expect(
      myVote([aVote({ voterId: "a", value: 1 }), aVote({ voterId: "me", isMe: true, value: -1 })]),
    ).toBe(-1);
  });
});

describe("unvotedByMe", () => {
  test("counts the proposals you have not voted on", () => {
    const proposals = [
      { votes: [aVote({ voterId: "me", isMe: true, value: 1 })] },
      { votes: [aVote({ voterId: "alice", value: 1 })] },
      { votes: [] },
    ];

    expect(unvotedByMe(proposals)).toBe(2);
  });
});

describe("membersWithoutVote", () => {
  // Who a nudge on a meal would reach (#16): current members with no vote on
  // any of the meal's proposals.
  const alice = { userId: "alice" };
  const bob = { userId: "bob" };
  const carol = { userId: "carol" };

  test("with nothing proposed or voted, it is everyone", () => {
    expect(membersWithoutVote([alice, bob, carol], [])).toEqual([alice, bob, carol]);
  });

  test("one vote on any of the meal's proposals is enough to count as having voted", () => {
    const meal = [
      { votes: [aVote({ voterId: "alice", value: 1 })] },
      { votes: [aVote({ voterId: "bob", value: -1 })] },
      { votes: [] },
    ];

    expect(membersWithoutVote([alice, bob, carol], meal)).toEqual([carol]);
  });

  test("a −1 counts as having voted as much as a +1", () => {
    const meal = [{ votes: [aVote({ voterId: "bob", value: -1 })] }];

    expect(membersWithoutVote([alice, bob], meal)).toEqual([alice]);
  });

  test("a departed member's vote neither adds them nor stands in for anyone", () => {
    // Only current members are passed in; dave left but his vote remains.
    const meal = [{ votes: [aVote({ voterId: "dave", value: 1 })] }];

    expect(membersWithoutVote([alice, bob], meal)).toEqual([alice, bob]);
  });

  test("when everyone has voted, nobody is left", () => {
    const meal = [
      { votes: [aVote({ voterId: "alice", value: 1 }), aVote({ voterId: "bob", value: 1 })] },
    ];

    expect(membersWithoutVote([alice, bob], meal)).toEqual([]);
  });
});
