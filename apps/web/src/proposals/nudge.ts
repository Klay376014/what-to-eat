/*
 * The nudge (#16): any member can email the people with no vote on a meal,
 * at most once per meal every six hours. What the button offers, and how long
 * is left of the cooldown, is worked out here; the database keeps the same
 * rule and is the judge (supabase/migrations/20261002090000_nudges.sql,
 * public.nudge_meal), so a nudge refused there is refused whatever this says.
 *
 * Pure.
 */
import { membersWithoutVote, type Vote } from "./vote.ts";

/** Six hours: one nudge in the morning for lunch, one in the afternoon for dinner. */
export const NUDGE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * How long until the meal can be nudged again, in milliseconds; 0 when it
 * can be now. At exactly six hours after the last nudge it can. Never more
 * than six hours, even when this device's clock is behind the server's.
 */
export function nudgeCooldownLeft(lastNudgedAt: string | null, now: Date): number {
  if (lastNudgedAt === null) return 0;
  const elapsed = now.getTime() - Date.parse(lastNudgedAt);
  return Math.min(NUDGE_COOLDOWN_MS, Math.max(0, NUDGE_COOLDOWN_MS - elapsed));
}

/** "5 h 12 min", "6 h", "42 min". A part minute counts as a whole one. */
export function formatCooldown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export type NudgeUnavailable = "decided" | "no-proposals" | "everyone-voted";

export type NudgeOffer<M> =
  | { kind: "ready"; waiting: M[] }
  | { kind: "cooldown"; remainingMs: number; waiting: M[] }
  | { kind: "unavailable"; reason: NudgeUnavailable };

/**
 * Whether the signed-in member is offered a nudge on the meal, and whom it
 * would reach: the current members with no vote on any of its proposals,
 * less themself. Not offered on a decided meal, one with nothing to vote on,
 * or one where everyone else has voted, cooldown or not.
 */
export function nudgeOffer<M extends { userId: string }>(input: {
  decided: boolean;
  proposals: readonly { votes: readonly Pick<Vote, "voterId">[] }[];
  /** The trip's current members. */
  members: readonly M[];
  meId: string;
  lastNudgedAt: string | null;
  now: Date;
}): NudgeOffer<M> {
  if (input.decided) return { kind: "unavailable", reason: "decided" };
  if (input.proposals.length === 0) return { kind: "unavailable", reason: "no-proposals" };
  const waiting = membersWithoutVote(
    input.members.filter((m) => m.userId !== input.meId),
    input.proposals,
  );
  if (waiting.length === 0) return { kind: "unavailable", reason: "everyone-voted" };
  const remainingMs = nudgeCooldownLeft(input.lastNudgedAt, input.now);
  return remainingMs > 0 ? { kind: "cooldown", remainingMs, waiting } : { kind: "ready", waiting };
}
