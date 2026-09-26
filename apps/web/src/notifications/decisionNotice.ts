/*
 * What a meal's decision emails say (#15). The database records a notice
 * each time a decision is made, changed or cleared, with the restaurant
 * before and after (20261001120000_email_notifications.sql). The notify Edge
 * Function takes a meal's waiting notices together and sends one email for
 * where they ended up: changes that piled up before a pass took them (the
 * app's own call did not get through, or they landed during a pass) are one
 * email, and a change undone before it was sent is none. Usually the app
 * asks right after each change, so each is its own email.
 *
 * Pure, and imported by the notify Edge Function.
 */
import type { DecisionChange } from "./emails.ts";

export interface DecisionNotice {
  /** Increases with each notice, so it orders them. */
  id: number;
  /** The decided proposal before the change, or null when undecided. */
  previousProposalId: string | null;
  previousPlaceName: string | null;
  /** The decided proposal after it, or null when cleared. */
  proposalId: string | null;
  placeName: string | null;
  /** Who made the change; null when unknown or their account is gone. */
  actorId: string | null;
}

/**
 * One meal's notices as one change, from before the first to after the last,
 * by whoever made the last; or null when it ended where it started.
 */
export function netDecisionChange(
  notices: readonly DecisionNotice[],
): { change: DecisionChange; actorId: string | null } | null {
  if (notices.length === 0) return null;
  const ordered = [...notices].sort((a, b) => a.id - b.id);
  const first = ordered[0]!;
  const last = ordered.at(-1)!;

  const before = first.previousProposalId === null ? null : (first.previousPlaceName ?? "");
  const after = last.proposalId === null ? null : (last.placeName ?? "");
  if (first.previousProposalId === last.proposalId) return null;

  const change: DecisionChange =
    before === null
      ? { kind: "decided", placeName: after! }
      : after === null
        ? { kind: "cleared", previousPlaceName: before }
        : { kind: "changed", placeName: after, previousPlaceName: before };
  return { change, actorId: last.actorId };
}
