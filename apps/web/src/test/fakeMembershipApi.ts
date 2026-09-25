import {
  MEMBER_LIMIT,
  MEMBER_LIMIT_REASON,
  type JoinFailureReason,
} from "../invitations/invitation.ts";
import {
  JoinError,
  type Invitation,
  type Member,
  type MembershipApi,
} from "../invitations/membershipApi.ts";
import type { Trip } from "../trips/trip.ts";
import type { TripsApi } from "../trips/tripsApi.ts";

/** A person in the fake world. */
export interface FakePerson {
  userId: string;
  name: string | null;
  avatarUrl?: string | null;
}

/**
 * What opening a token leads to: into a trip, or a refusal. The fake does not
 * decide whether a token is expired or revoked; a test says so up front, the
 * way the database would answer.
 */
export type FakeLink = { trip: Trip } | { refused: JoinFailureReason };

/**
 * An in-memory MembershipApi for component tests, with the same stance as
 * fakeTripsApi.ts: a working stand-in, not a record of calls, and it knows
 * nothing about who may do what. Access control is tested only in
 * supabase/tests/database/.
 *
 * `tripsApi` wraps a TripsApi so that trips joined through a link show up in
 * listTrips, as they would against the real backend.
 */
export function createFakeMembership(seed: {
  me: FakePerson;
  members?: Record<string, (FakePerson & { role: Member["role"] })[]>;
  links?: Record<string, FakeLink>;
  invitations?: Record<string, Invitation[]>;
  now?: () => Date;
}) {
  const now = seed.now ?? (() => new Date());
  const members = new Map(
    Object.entries(seed.members ?? {}).map(([tripId, list]) => [
      tripId,
      list.map((m) => ({ ...m })),
    ]),
  );
  const invitations = new Map(
    Object.entries(seed.invitations ?? {}).map(([tripId, list]) => [
      tripId,
      list.map((i) => ({ ...i })),
    ]),
  );
  const joined: Trip[] = [];
  /** Trips where I asked, at joining, not to be a calendar guest. */
  const optedOut = new Set<string>();
  let nextId = 1;

  function membersOf(tripId: string) {
    let list = members.get(tripId);
    if (!list) members.set(tripId, (list = []));
    return list;
  }

  function refuse(code: keyof typeof messages): never {
    throw new Error(messages[code]);
  }
  const messages = {
    trip_full: MEMBER_LIMIT_REASON,
    organiser_must_transfer:
      "You're the organiser. Hand the role to another member before you leave.",
  };

  const api: MembershipApi = {
    async joinTrip(token, options) {
      const link = seed.links?.[token];
      if (!link) throw new JoinError("invalid");
      if ("refused" in link) throw new JoinError(link.refused);

      const list = membersOf(link.trip.id);
      if (list.some((m) => m.userId === seed.me.userId)) {
        if (!options.calendarAttendee) optedOut.add(link.trip.id);
        return { tripId: link.trip.id, joined: false };
      }
      if (list.length >= MEMBER_LIMIT) throw new JoinError("full");
      list.push({ ...seed.me, role: "member" });
      joined.push({ ...link.trip, myRole: "member" });
      if (!options.calendarAttendee) optedOut.add(link.trip.id);
      else optedOut.delete(link.trip.id);
      return { tripId: link.trip.id, joined: true };
    },

    async listMembers(tripId) {
      return membersOf(tripId)
        .map((m) => ({
          userId: m.userId,
          name: m.name,
          avatarUrl: m.avatarUrl ?? null,
          role: m.role,
          isMe: m.userId === seed.me.userId,
        }))
        .sort((a, b) => Number(b.role === "organiser") - Number(a.role === "organiser"));
    },

    async removeMember(tripId, userId) {
      const list = membersOf(tripId);
      list.splice(
        list.findIndex((m) => m.userId === userId),
        1,
      );
    },

    async leaveTrip(tripId) {
      const list = membersOf(tripId);
      const mine = list.find((m) => m.userId === seed.me.userId);
      if (mine?.role === "organiser") refuse("organiser_must_transfer");
      list.splice(list.indexOf(mine!), 1);
    },

    async transferOrganiser(tripId, userId) {
      for (const m of membersOf(tripId)) {
        if (m.userId === seed.me.userId) m.role = "member";
        if (m.userId === userId) m.role = "organiser";
      }
    },

    async listInvitations(tripId) {
      return (invitations.get(tripId) ?? []).map((i) => ({ ...i }));
    },

    async createInvitation(tripId) {
      if (membersOf(tripId).length >= MEMBER_LIMIT) refuse("trip_full");
      const created = now();
      const invitation: Invitation = {
        id: `invitation-${nextId}`,
        token: `token-${nextId++}`,
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + 7 * 24 * 3_600_000).toISOString(),
        revokedAt: null,
      };
      invitations.set(tripId, [...(invitations.get(tripId) ?? []), invitation]);
      return { ...invitation };
    },

    async revokeInvitation(invitationId) {
      for (const list of invitations.values()) {
        const found = list.find((i) => i.id === invitationId);
        if (found) found.revokedAt ??= now().toISOString();
      }
    },
  };

  return {
    api,
    /**
     * Whether I am a guest on the trip's calendar events, as chosen when I
     * joined; null when I am not in the trip.
     */
    calendarAttendee(tripId: string): boolean | null {
      if (!membersOf(tripId).some((m) => m.userId === seed.me.userId)) return null;
      return !optedOut.has(tripId);
    },
    tripsApi(base: TripsApi): TripsApi {
      return {
        ...base,
        async listTrips() {
          return [...(await base.listTrips()), ...joined.map((t) => ({ ...t }))];
        },
      };
    },
  };
}
