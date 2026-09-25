-- Votes: each member's +1 or -1 on a proposal (#10).
--
-- A vote is +1 or -1 and nothing else. No vote means no opinion, so there is
-- no zero and no abstain: not voting already says it. A member has at most
-- one vote per proposal, and changes or withdraws it.
--
-- Votes are visible with who cast them. With this few people the point is
-- coordination, not a fair ballot: seeing that one person voted -1 is what
-- prompts asking them why.
--
-- A member who leaves the trip keeps their votes, counted and attributed, so
-- the tally behind a decision never changes when someone drops out; they just
-- can no longer see or touch them. Deleting an account takes its votes with
-- it: docs/privacy.md keeps only the restaurants a person proposed.
--
-- Votes also finish the proposal name lock (ADR 0005): the first vote on a
-- proposal locks its name and withdrawing the last one unlocks it, through
-- the private.lock_proposal_name() and private.unlock_proposal_name() hooks
-- that 20260926090000_proposals.sql left for this.

create table public.votes (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  -- Filled from the caller, never sent by the client (no grant below).
  voter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (proposal_id, voter_id)
);

-- The account-deletion cascade looks votes up by voter; the primary key
-- serves every lookup by proposal.
create index votes_voter_id_idx on public.votes (voter_id);

-- Casting or changing a vote ----------------------------------------------------
-- One call whether or not the caller has voted: insert, or change the value
-- in place. A plain upsert through the Data API cannot do this, because it
-- would also write proposal_id on conflict, and no client may update that.
--
-- SECURITY INVOKER: the caller's own grants and RLS decide, exactly as for a
-- direct insert or update, so this adds no power beyond saving a round trip.
create function public.cast_vote(proposal_id uuid, value smallint)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.votes (proposal_id, value)
  values (cast_vote.proposal_id, cast_vote.value)
  on conflict on constraint votes_pkey do update set value = excluded.value
$$;

-- The name lock -------------------------------------------------------------------
-- The first vote locks the proposal's name; withdrawing the last unlocks it
-- (not sticky: with no votes left, nobody's vote can be carried over to a
-- different restaurant). Changing a vote's value is an UPDATE and fires
-- neither. See docs/adr/0005-proposal-name-lock.md.
--
-- SECURITY DEFINER, owned by the migration role: the voter holds no grant on
-- name_locked_at and is usually not the proposer, and only the owner may
-- execute the lock and unlock.
--
-- Both take the proposal's row lock first, so votes on one proposal lock and
-- unlock one at a time. Without it, a withdrawal could count the remaining
-- votes, miss a vote being cast at that moment, and unlock a name that just
-- got a vote, or two withdrawals could each see the other's vote and leave
-- the name locked with none. FOR NO KEY UPDATE, not FOR UPDATE: every vote
-- insert holds a KEY SHARE lock on its proposal for the foreign key, which
-- FOR UPDATE conflicts with, risking a deadlock between two members voting
-- at once.
--
-- AFTER ROW triggers run once the whole statement is done, so a statement
-- that removes several votes finds none remaining and unlocks, as it should.
-- When a proposal is deleted with its trip, its row is already gone and there
-- is nothing to lock or unlock.

create function private.lock_name_on_first_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.proposals p where p.id = new.proposal_id for no key update;
  perform private.lock_proposal_name(new.proposal_id);
  return null;
end;
$$;

create function private.unlock_name_on_last_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.proposals p where p.id = old.proposal_id for no key update;
  if not exists (select 1 from public.votes v where v.proposal_id = old.proposal_id) then
    perform private.unlock_proposal_name(old.proposal_id);
  end if;
  return null;
end;
$$;

create trigger votes_lock_name
  after insert on public.votes
  for each row execute function private.lock_name_on_first_vote();

create trigger votes_unlock_name
  after delete on public.votes
  for each row execute function private.unlock_name_on_last_withdrawal();

-- RLS ---------------------------------------------------------------------
-- Every policy asks whether the vote's proposal belongs to a meal in a trip
-- the caller is currently in, written out as in the proposals migration.
--
-- Reading covers every vote in the trip, a departed member's included.
-- Casting, changing and withdrawing cover only the caller's own vote, and
-- only while they are a member: a departed member's vote stays as it was.
-- Nobody else's vote can be touched, not even by the organiser.
--
-- INSERT: a refused insert is 42501 whatever it carries. The WITH CHECK runs
-- before the CHECK constraint and the foreign key, so a stranger cannot tell
-- a real proposal id from an invented one by the error.

alter table public.votes enable row level security;

create policy votes_select on public.votes
  for select to authenticated
  using (
    proposal_id in (
      select p.id from public.proposals p
      join public.meals m on m.id = p.meal_id
      where m.trip_id in (select private.my_trip_ids())
    )
  );

create policy votes_insert on public.votes
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and proposal_id in (
      select p.id from public.proposals p
      join public.meals m on m.id = p.meal_id
      where m.trip_id in (select private.my_trip_ids())
    )
  );

create policy votes_update on public.votes
  for update to authenticated
  using (
    voter_id = (select auth.uid())
    and proposal_id in (
      select p.id from public.proposals p
      join public.meals m on m.id = p.meal_id
      where m.trip_id in (select private.my_trip_ids())
    )
  )
  with check (
    voter_id = (select auth.uid())
    and proposal_id in (
      select p.id from public.proposals p
      join public.meals m on m.id = p.meal_id
      where m.trip_id in (select private.my_trip_ids())
    )
  );

create policy votes_delete on public.votes
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and proposal_id in (
      select p.id from public.proposals p
      join public.meals m on m.id = p.meal_id
      where m.trip_id in (select private.my_trip_ids())
    )
  );

-- Grants ------------------------------------------------------------------
-- As in the earlier migrations: take back the Data API's default ALL, then
-- grant exactly what the policies are written for. A member writes only the
-- proposal and the value; who and when are the database's.
--
-- service_role reads votes (the digest and nudge of #15 and #16 need to know
-- who has voted) and writes none: every vote is cast by the member it is
-- from.

revoke all on public.votes from anon, authenticated, service_role;
grant select on public.votes to authenticated, service_role;
grant insert (proposal_id, value) on public.votes to authenticated;
grant update (value) on public.votes to authenticated;
grant delete on public.votes to authenticated;

revoke all on function public.cast_vote(uuid, smallint) from public, anon, service_role;
grant execute on function public.cast_vote(uuid, smallint) to authenticated;

revoke all on function private.lock_name_on_first_vote() from public, anon, authenticated, service_role;
revoke all on function private.unlock_name_on_last_withdrawal() from public, anon, authenticated, service_role;
