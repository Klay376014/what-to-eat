/*
 * What one member's daily digest for a trip says (#15): the proposals made
 * since the last digest, and the meals still waiting on their vote. A digest
 * with nothing new is not sent at all; an email that only repeats yesterday's
 * reminder is how a digest gets filtered into a folder nobody reads.
 *
 * A trip's first digest (no digest before it, as when a trip is new or this
 * ships to trips planned for weeks) looks back one day from its cut-off,
 * not to the start of the trip: weeks-old proposals are not news.
 *
 * Pure, and imported by the notify Edge Function.
 */
import { mealStart } from "../calendar/mealTime.ts";
import type { MealSlot } from "../grid/meal.ts";
import type { IsoDate } from "../trips/trip.ts";

export interface DigestProposal {
  id: string;
  placeName: string;
  /** Who proposed it; null once their account is gone. */
  proposedBy: string | null;
  proposerName: string | null;
  /** When it was proposed, as the database wrote it. */
  createdAt: string;
  /** Everyone with a vote on it, either way, departed members included. */
  voterIds: readonly string[];
}

export interface DigestMeal {
  id: string;
  date: IsoDate;
  slot: MealSlot;
  label: string | null;
  position: number;
  startTime: string | null;
  decided: boolean;
  proposals: readonly DigestProposal[];
}

export interface Digest<M extends DigestMeal = DigestMeal> {
  /** Per meal, the proposals new since the last digest, in the order made. */
  newProposals: { meal: M; proposals: DigestProposal[] }[];
  /** Undecided meals with something proposed and no vote of yours on any of it. */
  awaitingVote: M[];
}

/** How far back a trip's first digest looks, from its cut-off. */
export const FIRST_DIGEST_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface DigestInput<M extends DigestMeal> {
  recipientId: string;
  /** The day the digest is for, on the trip's clock. Earlier days are over. */
  today: IsoDate;
  /**
   * Where the last digest was cut off, or null when this is the trip's
   * first: then it starts FIRST_DIGEST_LOOKBACK_MS before `until`.
   */
  since: Date | null;
  /** Where this one is cut off: a proposal from then on waits for the next. */
  until: Date;
  meals: readonly M[];
}

/** The digest for one member, or null when there is nothing new to tell them. */
export function digestFor<M extends DigestMeal>(input: DigestInput<M>): Digest<M> | null {
  const { recipientId, today, since, until } = input;
  const meals = input.meals.filter((m) => m.date >= today).sort(byWhenItHappens);

  const from = since?.getTime() ?? until.getTime() - FIRST_DIGEST_LOOKBACK_MS;
  const isNew = (p: DigestProposal) => {
    const made = new Date(p.createdAt).getTime();
    return made >= from && made < until.getTime();
  };

  const newProposals = meals
    .map((meal) => ({
      meal,
      proposals: meal.proposals
        .filter((p) => p.proposedBy !== recipientId && isNew(p))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .filter((entry) => entry.proposals.length > 0);

  if (newProposals.length === 0) return null;

  const awaitingVote = meals.filter(
    (meal) =>
      !meal.decided &&
      meal.proposals.length > 0 &&
      !meal.proposals.some((p) => p.voterIds.includes(recipientId)),
  );

  return { newProposals, awaitingVote };
}

function byWhenItHappens(a: DigestMeal, b: DigestMeal): number {
  return (
    a.date.localeCompare(b.date) ||
    mealStart(a).localeCompare(mealStart(b)) ||
    a.position - b.position
  );
}
