/**
 * Votes on proposals (#10). A vote is +1 or −1 and nothing else: no vote is
 * no opinion, so there is no zero and no abstain.
 *
 * Votes are visible with who cast them, and a member who leaves the trip
 * keeps theirs, counted and named: the tally behind a decision does not
 * change when someone drops out.
 */
export type VoteValue = 1 | -1;

export interface Vote {
  voterId: string;
  /** Their Google name, or null when Google sent none. */
  voterName: string | null;
  /** An https picture URL, or null. */
  voterAvatarUrl: string | null;
  isMe: boolean;
  value: VoteValue;
}

export interface Tally {
  for: Vote[];
  against: Vote[];
}

/** Who voted which way: you first, then by name, the nameless last. */
export function tally(votes: readonly Vote[]): Tally {
  const ordered = [...votes].sort(byVoter);
  return {
    for: ordered.filter((v) => v.value === 1),
    against: ordered.filter((v) => v.value === -1),
  };
}

function byVoter(a: Vote, b: Vote): number {
  if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
  if (a.voterName === null || b.voterName === null) {
    return a.voterName === b.voterName ? 0 : a.voterName === null ? 1 : -1;
  }
  return a.voterName.localeCompare(b.voterName);
}

/** A voter as the tally names them. */
export function voterLabel(vote: Pick<Vote, "isMe" | "voterName">): string {
  if (vote.isMe) return "you";
  return vote.voterName ?? "a member with no name";
}

/** Your vote on a proposal, or null when you have not voted. */
export function myVote(votes: readonly Vote[]): VoteValue | null {
  return votes.find((v) => v.isMe)?.value ?? null;
}

/** How many of these proposals you have not voted on. */
export function unvotedByMe(proposals: readonly { votes: readonly Vote[] }[]): number {
  return proposals.filter((p) => myVote(p.votes) === null).length;
}

/**
 * The members with no vote on any of a meal's proposals: who a nudge on
 * that meal reaches (#16). Pass only current members; a departed member's
 * vote stays on the proposal but never makes them a recipient.
 */
export function membersWithoutVote<M extends { userId: string }>(
  members: readonly M[],
  mealProposals: readonly { votes: readonly Pick<Vote, "voterId">[] }[],
): M[] {
  const voted = new Set(mealProposals.flatMap((p) => p.votes.map((v) => v.voterId)));
  return members.filter((m) => !voted.has(m.userId));
}
