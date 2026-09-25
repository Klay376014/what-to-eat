import type { Proposal } from "../proposals/proposal.ts";
import { NameLockedError, type ProposalsApi } from "../proposals/proposalsApi.ts";
import type { Vote, VoteValue } from "../proposals/vote.ts";

export interface FakeProposalsApi extends ProposalsApi {
  /** Puts a proposal in the backend behind the screen's back, as another member would. */
  seed(proposal: Proposal): void;
  /**
   * Another member votes on the proposal behind the screen's back, which
   * locks its name as the database would.
   */
  castAs(proposalId: string, voter: { id: string; name: string | null }, value: VoteValue): void;
}

/**
 * An in-memory ProposalsApi for component tests: a working stand-in for the
 * backend, not a record of calls. Like the database, it keeps a meal's
 * proposals oldest first, stores optional text trimmed or null, keeps one
 * vote per member per proposal, locks a name while it has votes, and refuses
 * to change a locked name.
 *
 * It knows nothing about who may see or edit what. Access control is the
 * database's job and is tested there (supabase/tests/database/), never
 * through this.
 */
export function createFakeProposalsApi(
  options: { me?: { id: string; name: string | null }; proposals?: Proposal[] } = {},
): FakeProposalsApi {
  const me = options.me ?? { id: "me", name: "Mei Lin" };
  const proposals = (options.proposals ?? []).map((p) => ({ ...p, votes: [...p.votes] }));
  let nextId = 1;
  // Each new proposal is a minute after the last, starting 24 Sep 2026 02:00 UTC.
  let clock = Date.parse("2026-09-24T02:00:00Z");

  const copy = (p: Proposal): Proposal => ({ ...p, votes: p.votes.map((v) => ({ ...v })) });

  function find(proposalId: string): Proposal {
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new Error(`No proposal ${proposalId}`);
    return proposal;
  }

  /** Puts a member's vote in place of any they had, and relocks as the triggers do. */
  function setVote(proposal: Proposal, vote: Vote | null, voterId: string) {
    proposal.votes = proposal.votes.filter((v) => v.voterId !== voterId);
    if (vote) proposal.votes.push(vote);
    proposal.nameLocked = proposal.votes.length > 0;
  }

  return {
    async listProposals(mealId) {
      return proposals
        .filter((p) => p.mealId === mealId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(copy);
    },
    async propose(input) {
      const proposal: Proposal = {
        id: `proposal-${nextId++}`,
        mealId: input.mealId,
        placeName: input.placeName.trim(),
        sourceUrl: input.sourceUrl,
        note: input.note,
        lat: null,
        lng: null,
        proposedBy: me.id,
        proposedByMe: true,
        proposerName: me.name,
        createdAt: new Date((clock += 60_000)).toISOString(),
        nameLocked: false,
        votes: [],
      };
      proposals.push(proposal);
      return copy(proposal);
    },
    async editProposal(proposalId, edit) {
      const proposal = find(proposalId);
      const name = edit.placeName?.trim();
      if (name !== undefined && name !== proposal.placeName && proposal.nameLocked) {
        throw new NameLockedError();
      }
      if (name !== undefined) proposal.placeName = name;
      proposal.note = edit.note;
      return copy(proposal);
    },
    async vote(proposalId, value) {
      const proposal = find(proposalId);
      const vote = { voterId: me.id, voterName: me.name, voterAvatarUrl: null, isMe: true, value };
      setVote(proposal, vote, me.id);
      return copy(proposal);
    },
    async withdrawVote(proposalId) {
      const proposal = find(proposalId);
      setVote(proposal, null, me.id);
      return copy(proposal);
    },
    seed(proposal) {
      proposals.push(copy(proposal));
    },
    castAs(proposalId, voter, value) {
      const vote = {
        voterId: voter.id,
        voterName: voter.name,
        voterAvatarUrl: null,
        isMe: false,
        value,
      };
      setVote(find(proposalId), vote, voter.id);
    },
  };
}

let seededId = 1;

export function aProposal(
  overrides: Partial<Proposal> & Pick<Proposal, "mealId" | "placeName">,
): Proposal {
  const id = seededId++;
  return {
    id: `seeded-proposal-${id}`,
    sourceUrl: null,
    note: null,
    lat: null,
    lng: null,
    proposedBy: "someone-else",
    proposedByMe: false,
    proposerName: "Alice Chen",
    createdAt: new Date(Date.parse("2026-09-20T00:00:00Z") + id * 60_000).toISOString(),
    nameLocked: (overrides.votes?.length ?? 0) > 0,
    votes: [],
    ...overrides,
  };
}

export function aVote(overrides: Partial<Vote> & Pick<Vote, "voterId" | "value">): Vote {
  return { voterName: null, voterAvatarUrl: null, isMe: false, ...overrides };
}
