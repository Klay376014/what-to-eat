/*
 * The emails a notify pass puts in the outbox (#15): who gets what, and the
 * key each is sent under. The key is fixed by what the email is for, never by
 * when it was composed, so a pass retried after a crash composes the same
 * keys, the outbox refuses the repeats, and the provider is sent each key
 * once (its Idempotency-Key).
 *
 * Pure, and imported by the notify Edge Function.
 */
import type { Meal } from "../grid/meal.ts";
import type { IsoDate, Trip } from "../trips/trip.ts";
import { digestFor, type DigestMeal } from "./digest.ts";
import { netDecisionChange, type DecisionNotice } from "./decisionNotice.ts";
import { decisionEmail, digestEmail, nudgeEmail } from "./emails.ts";
import { emailRecipients, nudgeRecipients, type TripMemberContact } from "./recipients.ts";

/** An email for the outbox, to one member. */
export interface OutgoingEmail {
  dedupeKey: string;
  recipientId: string;
  subject: string;
  text: string;
  html: string;
}

type EmailTrip = Pick<Trip, "id" | "name">;

/** A trip's digests for `day`: one per current member who has something new. */
export function composeDigests(input: {
  appUrl: string;
  trip: EmailTrip;
  day: IsoDate;
  since: Date | null;
  until: Date;
  meals: readonly DigestMeal[];
  members: readonly TripMemberContact[];
}): OutgoingEmail[] {
  const { appUrl, trip, day, since, until, meals } = input;
  return emailRecipients(input.members).flatMap((member) => {
    const digest = digestFor({ recipientId: member.userId, today: day, since, until, meals });
    if (digest === null) return [];
    return [
      {
        dedupeKey: `digest:${trip.id}:${day}:${member.userId}`,
        recipientId: member.userId,
        ...digestEmail({ appUrl, trip, day, digest }),
      },
    ];
  });
}

/**
 * One meal's decision emails for its waiting notices: to every current
 * member but whoever made the last change, or none when the changes cancel
 * out. `members` includes those who left, so a departed decider is named.
 */
export function composeDecisionEmails(input: {
  appUrl: string;
  trip: EmailTrip;
  meal: Pick<Meal, "id" | "date" | "slot" | "label" | "startTime">;
  notices: readonly DecisionNotice[];
  members: readonly TripMemberContact[];
}): OutgoingEmail[] {
  const net = netDecisionChange(input.notices);
  if (net === null) return [];
  const lastId = Math.max(...input.notices.map((n) => n.id));
  const actorName = input.members.find((m) => m.userId === net.actorId)?.name ?? null;
  const email = decisionEmail({
    appUrl: input.appUrl,
    trip: input.trip,
    meal: input.meal,
    change: net.change,
    actorName,
  });
  return emailRecipients(input.members, { except: net.actorId }).map((member) => ({
    dedupeKey: `decision:${lastId}:${member.userId}`,
    recipientId: member.userId,
    ...email,
  }));
}

/** A meal's proposal as a nudge sees it: its name, and who has voted on it. */
export interface NudgeProposal {
  placeName: string;
  /** Everyone who voted on it, departed members included. */
  voterIds: readonly string[];
}

/**
 * A nudge's emails (#16): to each current member with no vote on the meal
 * as it stands when composed, never the nudger, and none once the meal is
 * decided. `members` includes those who left, so a departed nudger is named.
 */
export function composeNudgeEmails(input: {
  appUrl: string;
  trip: EmailTrip;
  meal: Pick<Meal, "id" | "date" | "slot" | "label" | "startTime">;
  nudge: { id: number; nudgedBy: string | null };
  decided: boolean;
  proposals: readonly NudgeProposal[];
  members: readonly TripMemberContact[];
}): OutgoingEmail[] {
  if (input.decided) return [];
  const { nudge } = input;
  const email = nudgeEmail({
    appUrl: input.appUrl,
    trip: input.trip,
    meal: input.meal,
    nudgerName: input.members.find((m) => m.userId === nudge.nudgedBy)?.name ?? null,
    placeNames: input.proposals.map((p) => p.placeName),
  });
  return nudgeRecipients(input.members, input.proposals, nudge.nudgedBy).map((member) => ({
    dedupeKey: `nudge:${nudge.id}:${member.userId}`,
    recipientId: member.userId,
    ...email,
  }));
}
