# A proposal's name locks through a marker that the votes set and clear

Status: accepted (#8, for #10)

## Context

#8 says that once anyone has voted on a proposal, its name is read-only for
everyone. The maintainer has since settled that the lock is not sticky: once
the last vote is withdrawn, the proposer may rename the proposal again. Without this rule, a +1 for a noodle shop could become a +1 for a
place nobody agreed to. The rule has to hold in the database, like every other
rule here, not only in the app.

Votes do not exist yet; they arrive in #10. So #8 has to enforce a rule about
a table that does not exist yet. Three options were considered:

| Option                                                                                             | Why not, or why                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. A trigger on `proposals` that looks for rows in `public.votes`, a table #10 creates             | The function would name a table that does not exist yet. It would need dynamic SQL or a `to_regclass` guard, and the lock could not be tested until #10.                             |
| B. Create a bare `votes` table now, with no grants, so the trigger can query it                    | #8 does not call for votes. It would set #10's schema (key, value constraint, who can write) before #10 has designed it, and it would leave a table in production that nothing uses. |
| C. A lock marker on the proposal, `name_locked_at`, that a trigger enforces and the vote path sets | Chosen. The rule is enforced in the database and fully tested today. #10 only has to call two functions.                                                                             |

## Decision

**C.** In `supabase/migrations/20260926090000_proposals.sql`:

- `proposals.name_locked_at timestamptz` is null while the name is
  editable. No client role, service_role included, may insert or update it:
  it has no column grant.
- The `proposals_name_lock` trigger (`private.keep_proposal_name_locked()`)
  runs before every update. It refuses the update with
  `P0001 proposal_name_locked` when a locked proposal's `place_name` would
  change. It refuses with `P0001 proposal_name_unlock` when anything but the
  unlock function clears the marker. This applies to every role, including
  service_role and the table owner. Sending the unchanged name is not a
  change, so the note stays editable.
- `private.lock_proposal_name(proposal_id uuid)` sets the marker if it is not
  set yet, and keeps the time of the first lock.
- `private.unlock_proposal_name(proposal_id uuid)` clears it. It sets the
  transaction-local setting `what_to_eat.unlocking_proposal` to the
  proposal's id, runs its UPDATE, and resets the setting straight away. The
  trigger allows a clear only when that setting names the row. A client
  cannot use a forged setting, because no client role holds UPDATE on the
  marker, and PostgREST offers no way to call `set_config`. Only the table
  owner could forge it, and the owner can drop the trigger anyway.
- Both functions are `SECURITY DEFINER`, and EXECUTE is revoked from every
  client role, service_role included.
- RLS filters an update's rows before triggers fire. So only the proposer,
  while still a member, can ever see the lock error. Another member, a
  departed member or a stranger simply gets zero rows.

The app reads `name_locked_at is not null` as `Proposal.nameLocked`. It hides
the name field and explains why. If someone votes while the proposer is
editing, the database refuses the edit, and the app explains that as well.

### What #10 must do

1. When a proposal gets its first vote, call
   `private.lock_proposal_name(new.proposal_id)`. When its last vote is
   withdrawn, call `private.unlock_proposal_name(old.proposal_id)`. Do both
   from triggers on `votes` whose functions are `SECURITY DEFINER` and owned
   by the migration role. They must be, because the voter has no grant on
   `name_locked_at` and is usually not the proposer. Calling lock on every
   insert is harmless. Call unlock only when no vote on the proposal remains.
2. Add a pgTAP test for the full path:
   - a member votes, and the proposer can no longer rename;
   - the vote is withdrawn, and the proposer can rename again;
   - while a second member's vote remains, withdrawing the first keeps the
     name locked.

   `proposals_edit.test.sql` covers the lock and unlock themselves, with the
   owner standing in for the votes.

3. Changing a vote from +1 to −1 neither locks nor unlocks anything.

### The lock is not sticky

Withdrawing the last vote unlocks the name (the maintainer's decision on
#8). With no votes left, nobody's +1 or −1 can be carried over to a
different restaurant, so the reason for the lock is gone. A new first vote
locks it again.

### A proposal outlives its proposer's account

Deleting an account clears `proposed_by`, and the app then shows "a member
who deleted their account". The proposal itself stays. Its name, note and
link describe a restaurant, not the person, and a decision may rest on it.
This was also the maintainer's decision on #8, and `docs/privacy.md` says
so.

## Consequences

- The lock holds today, and pgTAP tests it today, with nothing in the schema
  that predicts #10's design.
- The rule is split in two. This migration enforces "a locked name never
  changes, and only the unlock clears the lock". #10 makes "a proposal with
  votes is locked, and one without is not" true. If #10 forgets step 1, the
  lock never engages, or never lets go. That is why step 2 exists.
- The same reasoning keeps the link, coordinates and CID fixed after a
  proposal is made. They say which restaurant it is, so changing them would
  swap the restaurant just as a new name would. Only `place_name` and `note`
  have update grants, so these fields are fixed from the start, locked or
  not.
