# A proposal's name locks through a marker that the first vote sets

Status: accepted (#8, for #10)

## Context

#8 says that once anyone has voted on a proposal, its name is read-only for
everyone. Without this rule, a +1 for a noodle shop could become a +1 for a
place nobody agreed to. The rule has to hold in the database, like every other
rule here, not only in the app.

Votes do not exist yet; they arrive in #10. So #8 has to enforce a rule about
a table that does not exist yet. Three options were considered:

| Option                                                                                             | Why not, or why                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. A trigger on `proposals` that looks for rows in `public.votes`, a table #10 creates             | The function would name a table that does not exist yet. It would need dynamic SQL or a `to_regclass` guard, and the lock could not be tested until #10.                             |
| B. Create a bare `votes` table now, with no grants, so the trigger can query it                    | #8 does not call for votes. It would set #10's schema (key, value constraint, who can write) before #10 has designed it, and it would leave a table in production that nothing uses. |
| C. A lock marker on the proposal, `name_locked_at`, that a trigger enforces and the vote path sets | Chosen. The rule is enforced in the database and fully tested today. #10 only has to set the marker.                                                                                 |

## Decision

**C.** In `supabase/migrations/20260926090000_proposals.sql`:

- `proposals.name_locked_at timestamptz` is null until the name locks. No
  client role may insert or update it: it has no column grant.
- The `proposals_name_lock` trigger (`private.keep_proposal_name_locked()`)
  runs before every update. It refuses the update with
  `P0001 proposal_name_locked` when a locked proposal's `place_name` would
  change. It refuses with `P0001 proposal_name_unlock` when anyone tries to
  clear the marker. This applies to every role, including service_role and
  the table owner. Sending the unchanged name is not a change, so the note
  stays editable.
- `private.lock_proposal_name(proposal_id uuid)` sets the marker if it is not
  set yet, and keeps the time of the first lock. It is `SECURITY DEFINER`,
  and EXECUTE is revoked from every client role.
- RLS filters an update's rows before triggers fire. So only the proposer,
  while still a member, can ever see the lock error. Another member, a
  departed member or a stranger simply gets zero rows.

The app reads `name_locked_at is not null` as `Proposal.nameLocked`. It hides
the name field and explains why. If someone votes while the proposer is
editing, the database refuses the edit, and the app explains that as well.

### What #10 must do

1. On a new vote, call `private.lock_proposal_name(new.proposal_id)`. Do this
   from an `AFTER INSERT` trigger on `votes`, whose function is
   `SECURITY DEFINER` and owned by the migration role. It must be that,
   because the voter has no grant on `name_locked_at` and is usually not the
   proposer.
2. Add a pgTAP test for the full path: a member votes, and then the proposer
   cannot rename the proposal. `proposals_edit.test.sql` covers the lock
   itself, with the owner standing in for the first vote.
3. Changing a vote from +1 to −1 need not call the lock again. It is harmless
   if it does.

### The lock is sticky

Withdrawing the last vote does **not** unlock the name. #8 says the name
locks "once anyone has voted". A sticky lock is the simplest reading that
keeps the guarantee: someone saw the name, reacted to it, and their reaction
may still be steering the discussion even after they withdraw it. It also
means the marker never has to be recomputed from the votes.

If the maintainer wants "locked while any vote exists" instead, #10 can clear
`name_locked_at` when the last vote is deleted. The unlock guard in the
trigger would then have to allow the vote path. That is a change to this ADR,
not a new mechanism.

## Consequences

- The lock holds today, and pgTAP tests it today, with nothing in the schema
  that predicts #10's design.
- The rule is split in two. This migration enforces "a locked name never
  changes". #10 makes "a vote locks the name" true. If #10 forgets step 1,
  the lock never engages. That is why step 2 exists.
- The same reasoning keeps the link, coordinates and CID fixed after a
  proposal is made. They say which restaurant it is, so changing them would
  swap the restaurant just as a new name would. Only `place_name` and `note`
  have update grants, so these fields are fixed from the start, locked or
  not.
