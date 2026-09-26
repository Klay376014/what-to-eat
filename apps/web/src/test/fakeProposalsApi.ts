import type { Proposal } from "../proposals/proposal.ts";
import type { Decision } from "../proposals/decision.ts";
import type { ResolvedPlace } from "../proposals/mapsLink.ts";
import { nudgeCooldownLeft, NUDGE_COOLDOWN_MS } from "../proposals/nudge.ts";
import {
  AlreadyDecidedError,
  NameLockedError,
  NudgeRefusedError,
  type ProposalsApi,
} from "../proposals/proposalsApi.ts";
import type { Vote, VoteValue } from "../proposals/vote.ts";

export interface FakeProposalsApi extends ProposalsApi {
  /** Puts a proposal in the backend behind the screen's back, as another member would. */
  seed(proposal: Proposal): void;
  /**
   * Another member votes on the proposal behind the screen's back, which
   * locks its name as the database would.
   */
  castAs(proposalId: string, voter: { id: string; name: string | null }, value: VoteValue): void;
  /** Another member decides the meal behind the screen's back. */
  decideAs(mealId: string, proposalId: string, decider: { id: string; name: string | null }): void;
  /** Another member nudges the meal behind the screen's back, at `at`. */
  nudgeAs(mealId: string, at: string): void;
  /** Every nudge that got through, oldest first. */
  readonly nudges: readonly { mealId: string; at: string }[];
}

/**
 * An in-memory ProposalsApi for component tests: a working stand-in for the
 * backend, not a record of calls. Like the database, it keeps a meal's
 * proposals oldest first, stores optional text trimmed or null, keeps one
 * vote per member per proposal, locks a name while it has votes, keeps one
 * decision per meal from the meal's own proposals, refuses to change a
 * locked or decided name, gives a proposal made with a Maps link that
 * was already resolved that place's coordinates, and refuses a nudge the
 * database would (#16): within six hours of the meal's last, on a decided
 * meal, with nothing to vote on, or with everyone else voted.
 *
 * It knows nothing about who may see or edit what. Access control is the
 * database's job and is tested there (supabase/tests/database/), never
 * through this.
 */
export function createFakeProposalsApi(
  options: {
    me?: { id: string; name: string | null };
    proposals?: Proposal[];
    decisions?: Decision[];
    /**
     * Told whenever a meal's decision, or its decided restaurant, changes:
     * where the database queues the meal for its calendar (#12).
     */
    onDecisionChange?: (mealId: string, decided: boolean) => void;
    /**
     * What each Maps short link resolves to (#9), by the link as pasted
     * (trimmed); any other link could not be resolved.
     */
    places?: Record<string, ResolvedPlace>;
    /** The trip's current members besides me (#16); I am always one. */
    members?: { userId: string; name: string | null }[];
    /** When each meal was last nudged, by meal. */
    lastNudged?: Record<string, string>;
    /** The server's clock, for the nudge cooldown. */
    now?: () => Date;
  } = {},
): FakeProposalsApi {
  const changed = options.onDecisionChange ?? (() => {});
  const me = options.me ?? { id: "me", name: "Mei Lin" };
  const proposals = (options.proposals ?? []).map((p) => ({ ...p, votes: [...p.votes] }));
  const places = new Map(Object.entries(options.places ?? {}));
  /** The links resolved so far: the database's maps_links, which proposing reads. */
  const resolved = new Map<string, ResolvedPlace>();
  let nextId = 1;
  // Each new proposal is a minute after the last, starting 24 Sep 2026 02:00 UTC.
  let clock = Date.parse("2026-09-24T02:00:00Z");

  const decisions = new Map((options.decisions ?? []).map((d) => [d.mealId, { ...d }]));
  const now = options.now ?? (() => new Date());
  const members = [{ userId: me.id, name: me.name }, ...(options.members ?? [])];
  const nudges = Object.entries(options.lastNudged ?? {}).map(([mealId, at]) => ({ mealId, at }));
  const lastNudge = (mealId: string) =>
    nudges.filter((n) => n.mealId === mealId).at(-1)?.at ?? null;
  const copy = (p: Proposal): Proposal => ({ ...p, votes: p.votes.map((v) => ({ ...v })) });

  /** A decision of the meal with one of its own proposals, as the foreign key insists. */
  function makeDecision(
    mealId: string,
    proposalId: string,
    decider: { id: string; name: string | null },
  ): Decision {
    if (find(proposalId).mealId !== mealId) throw new Error("Not one of this meal's proposals");
    return {
      mealId,
      proposalId,
      decidedBy: decider.id,
      decidedByMe: decider.id === me.id,
      deciderName: decider.name,
      decidedAt: new Date((clock += 60_000)).toISOString(),
    };
  }

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
      // As the database's trigger does, from the link's resolution.
      const place = input.sourceUrl === null ? undefined : resolved.get(input.sourceUrl);
      const proposal: Proposal = {
        id: `proposal-${nextId++}`,
        mealId: input.mealId,
        placeName: input.placeName.trim(),
        sourceUrl: input.sourceUrl,
        note: input.note,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
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
      if (name !== undefined && name !== proposal.placeName) {
        if ([...decisions.values()].some((d) => d.proposalId === proposalId)) {
          throw new NameLockedError("decided");
        }
        if (proposal.nameLocked) throw new NameLockedError("voted");
      }
      if (name !== undefined) proposal.placeName = name;
      proposal.note = edit.note;
      const decidedMeal = [...decisions.values()].find((d) => d.proposalId === proposalId);
      if (decidedMeal) changed(decidedMeal.mealId, true);
      return copy(proposal);
    },
    async vote(proposalId, value) {
      const proposal = find(proposalId);
      setVote(proposal, aVote({ voterId: me.id, voterName: me.name, isMe: true, value }), me.id);
      return copy(proposal);
    },
    async withdrawVote(proposalId) {
      const proposal = find(proposalId);
      setVote(proposal, null, me.id);
      return copy(proposal);
    },
    async getDecision(mealId) {
      const found = decisions.get(mealId);
      return found ? { ...found } : null;
    },
    async decide(mealId, proposalId) {
      if (decisions.has(mealId)) throw new AlreadyDecidedError();
      const made = makeDecision(mealId, proposalId, me);
      decisions.set(mealId, made);
      changed(mealId, true);
      return { ...made };
    },
    async changeDecision(mealId, proposalId) {
      if (!decisions.has(mealId)) throw new Error("This meal is no longer decided.");
      const made = makeDecision(mealId, proposalId, me);
      decisions.set(mealId, made);
      changed(mealId, true);
      return { ...made };
    },
    async clearDecision(mealId) {
      if (!decisions.delete(mealId)) throw new Error("This decision can no longer be cleared.");
      changed(mealId, false);
    },
    async resolveMapsLink(sourceUrl) {
      const place = places.get(sourceUrl.trim());
      if (!place) return null;
      resolved.set(sourceUrl.trim(), place);
      return { ...place };
    },
    async getNudgeState(mealId) {
      return {
        meId: me.id,
        members: members.map((m) => ({ ...m })),
        lastNudgedAt: lastNudge(mealId),
      };
    },
    async nudge(mealId) {
      // The database's refusals, in its order (public.nudge_meal).
      if (decisions.has(mealId)) throw new NudgeRefusedError("decided");
      const mealProposals = proposals.filter((p) => p.mealId === mealId);
      if (mealProposals.length === 0) throw new NudgeRefusedError("no-proposals");
      const voted = new Set(mealProposals.flatMap((p) => p.votes.map((v) => v.voterId)));
      if (members.every((m) => m.userId === me.id || voted.has(m.userId))) {
        throw new NudgeRefusedError("everyone-voted");
      }
      const last = lastNudge(mealId);
      const at = now();
      if (nudgeCooldownLeft(last, at) > 0) {
        throw new NudgeRefusedError(
          "cooldown",
          new Date(Date.parse(last!) + NUDGE_COOLDOWN_MS).toISOString(),
        );
      }
      nudges.push({ mealId, at: at.toISOString() });
      return at.toISOString();
    },
    nudgeAs(mealId, at) {
      nudges.push({ mealId, at });
    },
    nudges,
    decideAs(mealId, proposalId, decider) {
      decisions.set(mealId, makeDecision(mealId, proposalId, decider));
      changed(mealId, true);
    },
    seed(proposal) {
      proposals.push(copy(proposal));
    },
    castAs(proposalId, voter, value) {
      setVote(
        find(proposalId),
        aVote({ voterId: voter.id, voterName: voter.name, value }),
        voter.id,
      );
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
