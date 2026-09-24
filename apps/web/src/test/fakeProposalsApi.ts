import type { Proposal } from "../proposals/proposal.ts";
import { NameLockedError, type ProposalsApi } from "../proposals/proposalsApi.ts";

export interface FakeProposalsApi extends ProposalsApi {
  /** Puts a proposal in the backend behind the screen's back, as another member would. */
  seed(proposal: Proposal): void;
  /** Someone votes on the proposal, which locks its name (#10). */
  vote(proposalId: string): void;
}

/**
 * An in-memory ProposalsApi for component tests: a working stand-in for the
 * backend, not a record of calls. Like the database, it keeps a meal's
 * proposals oldest first, stores optional text trimmed or null, and refuses
 * to change a name someone has voted on.
 *
 * It knows nothing about who may see or edit what. Access control is the
 * database's job and is tested there (supabase/tests/database/), never
 * through this.
 */
export function createFakeProposalsApi(
  options: { me?: { id: string; name: string | null }; proposals?: Proposal[] } = {},
): FakeProposalsApi {
  const me = options.me ?? { id: "me", name: "Mei Lin" };
  const proposals = (options.proposals ?? []).map((p) => ({ ...p }));
  let nextId = 1;
  // Each new proposal is a minute after the last, starting 24 Sep 2026 02:00 UTC.
  let clock = Date.parse("2026-09-24T02:00:00Z");

  const copy = (p: Proposal): Proposal => ({ ...p });

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
      };
      proposals.push(proposal);
      return copy(proposal);
    },
    async editProposal(proposalId, edit) {
      const proposal = proposals.find((p) => p.id === proposalId);
      if (!proposal) throw new Error(`No proposal ${proposalId}`);
      const name = edit.placeName?.trim();
      if (name !== undefined && name !== proposal.placeName && proposal.nameLocked) {
        throw new NameLockedError();
      }
      if (name !== undefined) proposal.placeName = name;
      proposal.note = edit.note;
      return copy(proposal);
    },
    seed(proposal) {
      proposals.push({ ...proposal });
    },
    vote(proposalId) {
      const proposal = proposals.find((p) => p.id === proposalId);
      if (!proposal) throw new Error(`No proposal ${proposalId}`);
      proposal.nameLocked = true;
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
    nameLocked: false,
    ...overrides,
  };
}
