import { memberLabel } from "./proposal.ts";

/**
 * A meal's decision (#11): which of its proposals the group is going to.
 * Any member decides; only the member who decided, or the organiser,
 * changes or clears it. A changed decision is the changer's, made then.
 *
 * One decision per meal, and only one of the meal's own proposals, are the
 * schema's rules (supabase/migrations/20260928090000_decisions.sql).
 */
export interface Decision {
  mealId: string;
  proposalId: string;
  /** Who decided (or last changed it); null once their account is deleted. */
  decidedBy: string | null;
  decidedByMe: boolean;
  /** Their Google name, or null when Google sent none. */
  deciderName: string | null;
  /** An instant (ISO 8601). */
  decidedAt: string;
}

/**
 * Whether the signed-in member may change or clear the decision. Only for
 * what the screen offers; the database decides who actually may.
 */
export function canChangeDecision(
  decision: Pick<Decision, "decidedByMe">,
  me: { organiser: boolean },
): boolean {
  return decision.decidedByMe || me.organiser;
}

/** Who decided, as the meal says it: "Decided by <this>". */
export function deciderLabel(
  decision: Pick<Decision, "decidedBy" | "decidedByMe" | "deciderName">,
): string {
  return memberLabel({
    isMe: decision.decidedByMe,
    id: decision.decidedBy,
    name: decision.deciderName,
  });
}
