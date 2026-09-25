import type { SupabaseClient } from "@supabase/supabase-js";
import { inject, type InjectionKey } from "vue";
import type { Database } from "../types/database.ts";
import type { NewProposal, Proposal, ProposalEdit } from "./proposal.ts";
import type { Vote, VoteValue } from "./vote.ts";

/**
 * A meal's proposals: what the meal's details read and write. A separate
 * seam from MealsApi, faked the same way in component tests
 * (src/test/fakeProposalsApi.ts).
 *
 * Who may read, propose, edit and vote, that nobody deletes, and that a
 * voted-on name stays put are all decided by the database
 * (supabase/migrations/20260926090000_proposals.sql and
 * 20260927090000_votes.sql) and tested there, never checked here.
 */
export interface ProposalsApi {
  /** The meal's proposals, oldest first. */
  listProposals(mealId: string): Promise<Proposal[]>;
  /** Proposes a restaurant as the signed-in member. */
  propose(proposal: NewProposal): Promise<Proposal>;
  /**
   * Edits one's own proposal. Throws NameLockedError when the name was
   * changed after someone voted.
   */
  editProposal(proposalId: string, edit: ProposalEdit): Promise<Proposal>;
  /**
   * Casts the signed-in member's vote, or changes it; returns the proposal
   * with its votes and name lock as they now stand.
   */
  vote(proposalId: string, value: VoteValue): Promise<Proposal>;
  /** Withdraws the signed-in member's vote, back to no opinion. */
  withdrawVote(proposalId: string): Promise<Proposal>;
}

/** Someone voted on the proposal, so its name can no longer change. */
export class NameLockedError extends Error {
  constructor() {
    super("Someone has voted on this proposal, so its name can no longer change.");
    this.name = "NameLockedError";
  }
}

export const proposalsApiKey: InjectionKey<ProposalsApi> = Symbol("ProposalsApi");

export function useProposalsApi(): ProposalsApi {
  const api = inject(proposalsApiKey);
  if (!api) throw new Error("No ProposalsApi provided");
  return api;
}

type Client = SupabaseClient<Database>;
type VoteRow = Pick<Database["public"]["Tables"]["votes"]["Row"], "voter_id" | "value">;
type ProposalRow = { votes: VoteRow[] } & Pick<
  Database["public"]["Tables"]["proposals"]["Row"],
  | "id"
  | "meal_id"
  | "place_name"
  | "source_url"
  | "note"
  | "lat"
  | "lng"
  | "proposed_by"
  | "created_at"
  | "name_locked_at"
>;

// Each proposal with its votes, embedded through votes.proposal_id.
const PROPOSAL_COLUMNS =
  "id, meal_id, place_name, source_url, note, lat, lng, proposed_by, created_at, name_locked_at, votes(voter_id, value)";

export function createSupabaseProposalsApi(client: Client): ProposalsApi {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Not signed in");
    return data.session.user.id;
  }

  /**
   * The rows as proposals, with each proposer's and voter's name (and each
   * voter's picture) from their profile. A departed member's profile is still
   * readable (profiles_select), so their votes stay attributed.
   */
  async function withPeople(rows: ProposalRow[]): Promise<Proposal[]> {
    const me = await currentUserId();
    const ids = [
      ...new Set(
        rows.flatMap((r) => [
          ...(r.proposed_by ? [r.proposed_by] : []),
          ...r.votes.map((v) => v.voter_id),
        ]),
      ),
    ];
    const profiles = new Map<string, { name: string | null; avatarUrl: string | null }>();
    if (ids.length > 0) {
      const { data, error } = await client
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", ids);
      if (error) throw error;
      for (const p of data) profiles.set(p.id, { name: p.display_name, avatarUrl: p.avatar_url });
    }
    const toVote = (v: VoteRow): Vote => ({
      voterId: v.voter_id,
      voterName: profiles.get(v.voter_id)?.name ?? null,
      voterAvatarUrl: profiles.get(v.voter_id)?.avatarUrl ?? null,
      isMe: v.voter_id === me,
      // The table's CHECK allows nothing else.
      value: v.value === 1 ? 1 : -1,
    });
    return rows.map((row) => ({
      id: row.id,
      mealId: row.meal_id,
      placeName: row.place_name,
      sourceUrl: row.source_url,
      note: row.note,
      lat: row.lat,
      lng: row.lng,
      proposedBy: row.proposed_by,
      proposedByMe: row.proposed_by === me,
      proposerName: row.proposed_by ? (profiles.get(row.proposed_by)?.name ?? null) : null,
      createdAt: row.created_at,
      nameLocked: row.name_locked_at !== null,
      votes: row.votes.map(toVote),
    }));
  }

  /** One proposal as it now stands, after a vote changed it. */
  async function getProposal(proposalId: string): Promise<Proposal> {
    const { data, error } = await client
      .from("proposals")
      .select(PROPOSAL_COLUMNS)
      .eq("id", proposalId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("This proposal is no longer available.");
    const [proposal] = await withPeople([data]);
    return proposal!;
  }

  return {
    async listProposals(mealId) {
      const { data, error } = await client
        .from("proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("meal_id", mealId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return withPeople(data);
    },

    async propose(proposal) {
      const { data, error } = await client
        .from("proposals")
        .insert({
          meal_id: proposal.mealId,
          place_name: proposal.placeName.trim(),
          source_url: proposal.sourceUrl,
          note: proposal.note,
        })
        .select(PROPOSAL_COLUMNS)
        .single();
      if (error) throw error;
      const [created] = await withPeople([data]);
      return created!;
    },

    async editProposal(proposalId, edit) {
      const changes: Database["public"]["Tables"]["proposals"]["Update"] = { note: edit.note };
      if (edit.placeName !== undefined) changes.place_name = edit.placeName.trim();
      // RLS turns a refused edit into zero rows rather than an error, so ask
      // for the row back to tell the two apart.
      const { data, error } = await client
        .from("proposals")
        .update(changes)
        .eq("id", proposalId)
        .select(PROPOSAL_COLUMNS);
      if (error?.code === "P0001" && error.message === "proposal_name_locked") {
        throw new NameLockedError();
      }
      if (error) throw error;
      const [row] = data;
      if (!row) throw new Error("This proposal can no longer be edited.");
      const [edited] = await withPeople([row]);
      return edited!;
    },

    async vote(proposalId, value) {
      const { error } = await client.rpc("cast_vote", { proposal_id: proposalId, value });
      if (error) throw error;
      return getProposal(proposalId);
    },

    async withdrawVote(proposalId) {
      const me = await currentUserId();
      const { error } = await client
        .from("votes")
        .delete()
        .eq("proposal_id", proposalId)
        .eq("voter_id", me);
      if (error) throw error;
      return getProposal(proposalId);
    },
  };
}
