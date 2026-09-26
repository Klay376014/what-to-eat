/*
 * Who a trip's emails go to (#15), and who a nudge reaches (#16).
 *
 * The trip's current members, by the address on their account. This is not
 * the calendar's attendee list (calendar_attendees(), #14): opting out of
 * being a calendar guest keeps an address out of Google's invitations, not
 * out of the app's own email, which only ever goes to that member.
 *
 * Pure, and imported by the notify Edge Function.
 */
import { membersWithoutVote } from "../proposals/vote.ts";

export interface TripMemberContact {
  userId: string;
  /** The address on their account, or null when it has none. */
  email: string | null;
  name: string | null;
  /** When they left the trip, or null while they are in it. */
  leftAt: string | null;
}

export type EmailRecipient<M extends TripMemberContact = TripMemberContact> = M & {
  email: string;
};

/** The members to email, once each: current ones with an address, less `except`. */
export function emailRecipients<M extends TripMemberContact>(
  members: readonly M[],
  options: { except?: string | null } = {},
): EmailRecipient<M>[] {
  const seen = new Set<string>();
  const out: EmailRecipient<M>[] = [];
  for (const member of members) {
    if (member.leftAt !== null || member.email === null) continue;
    if (member.userId === options.except || seen.has(member.userId)) continue;
    seen.add(member.userId);
    out.push(member as EmailRecipient<M>);
  }
  return out;
}

/**
 * Who a nudge on a meal reaches (#16): the current members with an address
 * and no vote on any of the meal's proposals, less the member nudging. A
 * departed member's vote stays on its proposal but makes nobody a voter.
 */
export function nudgeRecipients<M extends TripMemberContact>(
  members: readonly M[],
  mealProposals: readonly { voterIds: readonly string[] }[],
  nudgerId: string | null,
): EmailRecipient<M>[] {
  return membersWithoutVote(
    emailRecipients(members, { except: nudgerId }),
    mealProposals.map((p) => ({ votes: p.voterIds.map((voterId) => ({ voterId })) })),
  );
}
