import type { SupabaseClient } from "@supabase/supabase-js";
import { inject, type InjectionKey } from "vue";
import type { TripRole } from "../trips/trip.ts";
import type { Database } from "../types/database.ts";
import { MEMBER_LIMIT_REASON, type InvitationTimes, type JoinFailureReason } from "./invitation.ts";

/** A current member of a trip, as the members list shows them. */
export interface Member {
  userId: string;
  /** Their Google name, or null when Google sent none. */
  name: string | null;
  /** An https picture URL, or null. */
  avatarUrl: string | null;
  role: TripRole;
  isMe: boolean;
}

export interface JoinResult {
  tripId: string;
  /** True when this made the caller a member; false when they already were. */
  joined: boolean;
}

export interface JoinOptions {
  /** Be a guest on the trip's calendar events, which shows others your email. */
  calendarAttendee: boolean;
}

export interface Invitation extends InvitationTimes {
  id: string;
  token: string;
}

/** Opening an invitation did not put the person in the trip. */
export class JoinError extends Error {
  readonly reason: JoinFailureReason;

  constructor(reason: JoinFailureReason) {
    super(`Couldn't join the trip (${reason})`);
    this.name = "JoinError";
    this.reason = reason;
  }
}

/**
 * Invitations and membership: everything the join flow and the members
 * screen read and write. A separate seam from TripsApi, faked the same way in
 * component tests (src/test/fakeMembershipApi.ts).
 *
 * Who may do what is decided by the database functions in
 * supabase/migrations/20260925100000_invitations.sql and tested there, never
 * checked here.
 */
export interface MembershipApi {
  /**
   * Joins the trip the token opens; throws JoinError. `joined` is false when
   * the caller was already a member, so nobody is welcomed twice.
   *
   * `calendarAttendee: false` joins without being a guest on the trip's
   * calendar events (#14); it goes in with the membership. For a member
   * reopening a link, only `false` counts: it opts them out.
   */
  joinTrip(token: string, options: JoinOptions): Promise<JoinResult>;
  /** The trip's current members, the organiser first. */
  listMembers(tripId: string): Promise<Member[]>;
  removeMember(tripId: string, userId: string): Promise<void>;
  leaveTrip(tripId: string): Promise<void>;
  transferOrganiser(tripId: string, userId: string): Promise<void>;
  /** Every invitation issued for the trip; readable by its organiser only. */
  listInvitations(tripId: string): Promise<Invitation[]>;
  createInvitation(tripId: string): Promise<Invitation>;
  revokeInvitation(invitationId: string): Promise<void>;
}

export const membershipApiKey: InjectionKey<MembershipApi> = Symbol("MembershipApi");

export function useMembershipApi(): MembershipApi {
  const api = inject(membershipApiKey);
  if (!api) throw new Error("No MembershipApi provided");
  return api;
}

/**
 * What the database's refusals mean to a person. The functions raise P0001
 * with a fixed message; anything else keeps its own message.
 */
const refusals: Record<string, string> = {
  trip_full: MEMBER_LIMIT_REASON,
  organiser_must_transfer:
    "You're the organiser. Hand the role to another member before you leave.",
  not_a_member: "That person is no longer in the trip.",
};

const joinReasons: Record<string, JoinFailureReason> = {
  invitation_expired: "expired",
  invitation_revoked: "revoked",
  invitation_invalid: "invalid",
  trip_full: "full",
  invitation_predates_departure: "predates_departure",
};

interface DbError {
  code?: string;
  message: string;
}

function explained(error: DbError): Error {
  const known = error.code === "P0001" ? refusals[error.message] : undefined;
  return new Error(known ?? error.message);
}

type Client = SupabaseClient<Database>;
type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

const INVITATION_COLUMNS = "id, token, created_at, expires_at, revoked_at";

function toInvitation(
  row: Pick<InvitationRow, "id" | "token" | "created_at" | "expires_at" | "revoked_at">,
): Invitation {
  return {
    id: row.id,
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function createSupabaseMembershipApi(client: Client): MembershipApi {
  async function currentUserId(): Promise<string> {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Not signed in");
    return data.session.user.id;
  }

  return {
    async joinTrip(token, options) {
      const { data, error } = await client
        .rpc("join_trip", { token, calendar_attendee: options.calendarAttendee })
        .single();
      if (error) {
        const reason = error.code === "P0001" ? joinReasons[error.message] : undefined;
        if (reason) throw new JoinError(reason);
        throw error;
      }
      return { tripId: data.trip_id, joined: data.joined };
    },

    async listMembers(tripId) {
      const me = await currentUserId();
      const { data: members, error } = await client
        .from("trip_members")
        .select("user_id, role, joined_at")
        .eq("trip_id", tripId)
        .is("left_at", null)
        .order("joined_at", { ascending: true });
      if (error) throw error;

      const ids = members.map((m) => m.user_id);
      const { data: profiles, error: profileError } = await client
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", ids);
      if (profileError) throw profileError;
      const profileOf = new Map(profiles.map((p) => [p.id, p]));

      return members
        .map((m) => ({
          userId: m.user_id,
          name: profileOf.get(m.user_id)?.display_name ?? null,
          avatarUrl: profileOf.get(m.user_id)?.avatar_url ?? null,
          role: m.role,
          isMe: m.user_id === me,
        }))
        .sort((a, b) => Number(b.role === "organiser") - Number(a.role === "organiser"));
    },

    async removeMember(tripId, userId) {
      const { error } = await client.rpc("remove_member", { trip_id: tripId, user_id: userId });
      if (error) throw explained(error);
    },

    async leaveTrip(tripId) {
      const { error } = await client.rpc("leave_trip", { trip_id: tripId });
      if (error) throw explained(error);
    },

    async transferOrganiser(tripId, userId) {
      const { error } = await client.rpc("transfer_organiser", {
        trip_id: tripId,
        user_id: userId,
      });
      if (error) throw explained(error);
    },

    async listInvitations(tripId) {
      const { data, error } = await client
        .from("invitations")
        .select(INVITATION_COLUMNS)
        .eq("trip_id", tripId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data.map(toInvitation);
    },

    async createInvitation(tripId) {
      const { data, error } = await client.rpc("create_invitation", { trip_id: tripId }).single();
      if (error) throw explained(error);
      return toInvitation(data);
    },

    async revokeInvitation(invitationId) {
      const { error } = await client.rpc("revoke_invitation", { invitation_id: invitationId });
      if (error) throw explained(error);
    },
  };
}
