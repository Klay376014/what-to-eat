import type { SupabaseClient } from "@supabase/supabase-js";
import { inject, type InjectionKey } from "vue";
import type { Database } from "../types/database.ts";
import type { NewProposal, Proposal, ProposalEdit } from "./proposal.ts";

/**
 * A meal's proposals: what the meal's details read and write. A separate
 * seam from MealsApi, faked the same way in component tests
 * (src/test/fakeProposalsApi.ts).
 *
 * Who may read, propose and edit, that nobody deletes, and that a voted-on
 * name stays put are all decided by the database
 * (supabase/migrations/20260926090000_proposals.sql) and tested there,
 * never checked here.
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
type ProposalRow = Pick<
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

const PROPOSAL_COLUMNS =
  "id, meal_id, place_name, source_url, note, lat, lng, proposed_by, created_at, name_locked_at";

export function createSupabaseProposalsApi(client: Client): ProposalsApi {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Not signed in");
    return data.session.user.id;
  }

  /** The rows as proposals, with each proposer's name from their profile. */
  async function withProposers(rows: ProposalRow[]): Promise<Proposal[]> {
    const me = await currentUserId();
    const ids = [...new Set(rows.flatMap((r) => (r.proposed_by ? [r.proposed_by] : [])))];
    const names = new Map<string, string | null>();
    if (ids.length > 0) {
      const { data, error } = await client
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      if (error) throw error;
      for (const p of data) names.set(p.id, p.display_name);
    }
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
      proposerName: row.proposed_by ? (names.get(row.proposed_by) ?? null) : null,
      createdAt: row.created_at,
      nameLocked: row.name_locked_at !== null,
    }));
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
      return withProposers(data);
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
      const [created] = await withProposers([data]);
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
      const [edited] = await withProposers([row]);
      return edited!;
    },
  };
}
