/*
 * The notify passes (#15; ADR 0009). Each is safe to run twice at once or
 * again after a crash: the database hands out work under five-minute claims,
 * records a digest day and a notice's emails only once, and the outbox keys
 * each email so it is sent once (Resend's Idempotency-Key covers a send whose
 * answer was lost).
 *
 *   digestPass    for each trip past 08:00 on its clock with no digest yet
 *                 today: compose each member's digest, record the day.
 *   decisionPass  for each meal with decision notices waiting: compose one
 *                 email per member for where the changes ended up.
 *   nudgePass     for each nudge waiting (#16): compose one email per member
 *                 with no vote on the meal, never the nudger.
 *   deliverPass   send what the outbox has due, and record each outcome.
 *
 * What the emails say, and who gets them, is in apps/web/src/notifications.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composeDecisionEmails,
  composeDigests,
  composeNudgeEmails,
  type NudgeProposal,
  type OutgoingEmail,
} from "../../../apps/web/src/notifications/compose.ts";
import type { DecisionNotice } from "../../../apps/web/src/notifications/decisionNotice.ts";
import { sendEmail, type ResendConfig } from "../../../apps/web/src/notifications/delivery.ts";
import type { DigestMeal, DigestProposal } from "../../../apps/web/src/notifications/digest.ts";
import { dueDigestDay } from "../../../apps/web/src/notifications/digestSchedule.ts";
import type { TripMemberContact } from "../../../apps/web/src/notifications/recipients.ts";
import type { Database } from "../../../apps/web/src/types/database.ts";

type Admin = SupabaseClient<Database>;

export interface NotifyConfig {
  resend: ResendConfig;
  /** Where the app is: every email links into it. */
  appUrl: string;
}

/** How many emails one pass sends at most; the next minute's pass sends the rest. */
const SEND_LIMIT = 40;
/** Resend allows two requests a second by default. */
const SEND_GAP_MS = 550;
/**
 * Proposals from the last half minute wait for tomorrow's digest: one being
 * written as the digest is read could otherwise land on neither side.
 */
const CUT_OFF_LAG_MS = 30_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function outboxRows(emails: readonly OutgoingEmail[]) {
  return emails.map((e) => ({
    dedupe_key: e.dedupeKey,
    recipient_id: e.recipientId,
    subject: e.subject,
    text: e.text,
    html: e.html,
  }));
}

async function contacts(admin: Admin, tripId: string): Promise<TripMemberContact[]> {
  const { data, error } = await admin.rpc("trip_contacts", { trip_id: tripId });
  if (error) throw error;
  return data.map((c) => ({ userId: c.user_id, email: c.email, name: c.name, leftAt: c.left_at }));
}

/** Composes and records every digest due at `now`. Returns how many trips it recorded. */
export async function digestPass(admin: Admin, config: NotifyConfig, now: Date): Promise<number> {
  const { data: trips, error } = await admin.rpc("digest_trips");
  if (error) throw error;

  let recorded = 0;
  for (const trip of trips) {
    try {
      // Inside the try: a zone the database knows but this runtime's Intl
      // does not would throw, and must not hold up every other trip.
      const day = dueDigestDay(
        { timezone: trip.timezone, endDate: trip.end_date },
        trip.last_date,
        now,
      );
      if (day === null) continue;
      const until = new Date(now.getTime() - CUT_OFF_LAG_MS);
      const { data: rows, error: mealsError } = await admin.rpc("digest_meals", {
        trip_id: trip.trip_id,
        from_date: day,
      });
      if (mealsError) throw mealsError;
      const meals: DigestMeal[] = rows.map((m) => ({
        id: m.id,
        date: m.date,
        slot: m.slot,
        label: m.label,
        position: m.position,
        startTime: m.start_time,
        decided: m.decided,
        proposals: m.proposals as unknown as DigestProposal[],
      }));
      const emails = composeDigests({
        appUrl: config.appUrl,
        trip: { id: trip.trip_id, name: trip.name },
        day,
        since: trip.last_cut_off ? new Date(trip.last_cut_off) : null,
        until,
        meals,
        members: await contacts(admin, trip.trip_id),
      });
      const { error: recordError } = await admin.rpc("record_digest", {
        trip_id: trip.trip_id,
        local_date: day,
        cut_off: until.toISOString(),
        emails: outboxRows(emails),
      });
      if (recordError) throw recordError;
      recorded++;
    } catch (e) {
      // One trip's failure does not hold up the others; it is due again next minute.
      console.error(`notify: digest for trip ${trip.trip_id} failed: ${message(e)}`);
    }
  }
  return recorded;
}

/** Composes the emails for waiting decision notices, of one trip or all. */
export async function decisionPass(
  admin: Admin,
  config: NotifyConfig,
  tripId: string | null,
): Promise<void> {
  const { data: notices, error } = await admin.rpc("claim_decision_notices", {
    only_trip: tripId,
  });
  if (error) throw error;

  const byMeal = new Map<string, typeof notices>();
  for (const n of notices) byMeal.set(n.meal_id, [...(byMeal.get(n.meal_id) ?? []), n]);

  const members = new Map<string, TripMemberContact[]>();
  for (const [, mealNotices] of byMeal) {
    const first = mealNotices[0]!;
    try {
      if (!members.has(first.trip_id))
        members.set(first.trip_id, await contacts(admin, first.trip_id));
      const emails = composeDecisionEmails({
        appUrl: config.appUrl,
        trip: { id: first.trip_id, name: first.trip_name },
        meal: {
          id: first.meal_id,
          date: first.date,
          slot: first.slot,
          label: first.label,
          startTime: first.start_time,
        },
        notices: mealNotices.map((n): DecisionNotice => ({
          id: n.id,
          previousProposalId: n.previous_proposal_id,
          previousPlaceName: n.previous_place_name,
          proposalId: n.proposal_id,
          placeName: n.place_name,
          actorId: n.actor_id,
        })),
        members: members.get(first.trip_id)!,
      });
      const { error: recordError } = await admin.rpc("record_decision_emails", {
        notice_ids: mealNotices.map((n) => n.id),
        trip_id: first.trip_id,
        emails: outboxRows(emails),
      });
      if (recordError) throw recordError;
    } catch (e) {
      // Left claimed; taken up again when the claim runs out.
      console.error(`notify: decision emails for meal ${first.meal_id} failed: ${message(e)}`);
    }
  }
}

/**
 * Composes the emails for waiting nudges (#16), of one trip or all: to each
 * current member with no vote on the meal as it now stands, never the nudger.
 */
export async function nudgePass(
  admin: Admin,
  config: NotifyConfig,
  tripId: string | null,
): Promise<void> {
  const { data: nudges, error } = await admin.rpc("claim_nudges", { only_trip: tripId });
  if (error) throw error;

  const members = new Map<string, TripMemberContact[]>();
  for (const nudge of nudges) {
    try {
      if (!members.has(nudge.trip_id))
        members.set(nudge.trip_id, await contacts(admin, nudge.trip_id));
      const emails = composeNudgeEmails({
        appUrl: config.appUrl,
        trip: { id: nudge.trip_id, name: nudge.trip_name },
        meal: {
          id: nudge.meal_id,
          date: nudge.date,
          slot: nudge.slot,
          label: nudge.label,
          startTime: nudge.start_time,
        },
        nudge: { id: nudge.id, nudgedBy: nudge.nudged_by },
        decided: nudge.decided,
        proposals: nudge.proposals as unknown as NudgeProposal[],
        members: members.get(nudge.trip_id)!,
      });
      const { error: recordError } = await admin.rpc("record_nudge_emails", {
        nudge_id: nudge.id,
        trip_id: nudge.trip_id,
        emails: outboxRows(emails),
      });
      if (recordError) throw recordError;
    } catch (e) {
      // Left claimed; taken up again when the claim runs out.
      console.error(`notify: nudge emails for meal ${nudge.meal_id} failed: ${message(e)}`);
    }
  }
}

/** Sends what the outbox has due, of one trip or all. Returns how many were sent. */
export async function deliverPass(
  admin: Admin,
  config: NotifyConfig,
  tripId: string | null,
): Promise<number> {
  const { data: emails, error } = await admin.rpc("claim_emails", {
    only_trip: tripId,
    max_count: SEND_LIMIT,
  });
  if (error) throw error;

  let sent = 0;
  for (const [i, email] of emails.entries()) {
    if (i > 0) await wait(SEND_GAP_MS);
    const outcome = await sendEmail(
      config.resend,
      { to: email.to_email, subject: email.subject, text: email.body_text, html: email.body_html },
      email.dedupe_key,
    );
    const { error: finishError } = await admin.rpc("finish_email", {
      id: email.id,
      provider_id: outcome.sent ? outcome.providerId : null,
      error: outcome.sent ? null : outcome.error,
      retry: outcome.sent ? false : outcome.retry,
    });
    if (finishError) {
      // The claim runs out and it is sent again under the same key, which
      // Resend answers without sending a second email.
      console.error(`notify: recording email ${email.id} failed: ${message(finishError)}`);
    }
    if (outcome.sent) sent++;
    else console.error(`notify: email ${email.id} not sent: ${outcome.error}`);
  }
  return sent;
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return String(e);
}
