/**
 * Invitation links: their shape, and what the app tells people about them.
 *
 * The link is the app's own address with `?invite=<token>`. A query
 * parameter rather than a path such as `/invite/<token>`, because it works on
 * any static host with no rewrite rule: the server always serves the one
 * index.html, and the app reads the parameter at startup
 * (pendingInvite.ts). It sits beside `?day=` (the trip grid) without
 * touching it.
 *
 * Whether a token is any good is decided by the database (join_trip in
 * supabase/migrations/20260925100000_invitations.sql), never here.
 */

/** The most current members a trip may have; the database enforces it. */
export const MEMBER_LIMIT = 8;

/**
 * Why the limit exists, in the words the app uses wherever it refuses (PRD:
 * "enforce it with an explanation rather than letting the experience quietly
 * degrade").
 */
export const MEMBER_LIMIT_REASON =
  `A trip holds at most ${MEMBER_LIMIT} people. Past that, voting on each restaurant ` +
  "stops being a quick group decision and turns into a survey nobody finishes.";

const PARAM = "invite";

/** The token in `?invite=`, or null when the address carries none. */
export function readInviteToken(search: string): string | null {
  const value = new URLSearchParams(search).get(PARAM)?.trim();
  return value ? value : null;
}

/** The same address with `?invite=` taken out and everything else kept. */
export function locationWithoutInvite(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete(PARAM);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ""}${hash}`;
}

/** The link an organiser shares; `appUrl` is where the app is served from. */
export function inviteUrl(token: string, appUrl: string): string {
  const url = new URL(appUrl);
  url.search = new URLSearchParams({ [PARAM]: token }).toString();
  url.hash = "";
  return url.toString();
}

export interface InvitationTimes {
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type InvitationStatus = "active" | "expired" | "revoked";

/** Mirrors the database's rule, for showing which links still work. */
export function invitationStatus(invitation: InvitationTimes, now: Date): InvitationStatus {
  if (invitation.revokedAt !== null) return "revoked";
  if (now.getTime() >= new Date(invitation.expiresAt).getTime()) return "expired";
  return "active";
}

/**
 * How long a working link has left, as "6 days" or "5 hours". Relative on
 * purpose: an expiry is an instant, and a relative time needs no timezone.
 */
export function timeLeft(expiresAt: string, now: Date): string {
  const hours = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 24) return "1 day";
  if (hours >= 2) return `${hours} hours`;
  if (hours >= 1) return "1 hour";
  return "less than an hour";
}

/** Why opening a link did not put the person in the trip. */
export type JoinFailureReason =
  | "expired"
  | "revoked"
  | "invalid"
  | "full"
  | "predates_departure"
  | "unknown";

/** What the person is told when a link does not work. Names no trip. */
export function explainJoinFailure(reason: JoinFailureReason): { title: string; body: string } {
  switch (reason) {
    case "expired":
      return {
        title: "This invitation has expired",
        body: "Invitation links work for 7 days after they are made. Ask the organiser for a new one.",
      };
    case "revoked":
      return {
        title: "This invitation was withdrawn",
        body: "The organiser turned this link off. Ask them for a new one if you should be in the trip.",
      };
    case "invalid":
      return {
        title: "This invitation link doesn't work",
        body: "It may have been cut short when it was copied. Open the whole link again, or ask the organiser for a new one.",
      };
    case "full":
      return {
        title: "This trip is full",
        body: `${MEMBER_LIMIT_REASON} Ask the organiser whether someone is leaving.`,
      };
    case "predates_departure":
      return {
        title: "This link is from before you left",
        body: "You left this trip, or were removed, after this link was made. Ask the organiser for a new one to come back.",
      };
    case "unknown":
      return {
        title: "Couldn't join the trip",
        body: "Something went wrong while opening the invitation. Try the link again, or ask the organiser for a new one.",
      };
  }
}
