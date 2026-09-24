-- Proposals: the restaurants put forward for a meal (#8).
--
-- For now a proposal's name is typed by hand. Filling it in from a pasted
-- Google Maps link is #9, and a broken extractor must never block proposing,
-- so nothing here depends on it: the name is the only required field, and the
-- columns #9 fills (place_cid, lat, lng) are optional.
--
-- Two rules that look small and are not:
--
--   - A proposal is never deleted. The record of what was considered is what
--     makes a past decision legible. No role holds DELETE or TRUNCATE, not
--     even service_role, and there is no DELETE policy. The only way one goes
--     is with its trip, when the organiser deletes the whole trip.
--   - The name is locked while anyone has a vote on it. Otherwise a +1 for a
--     noodle shop could be turned into a +1 for somewhere nobody agreed to.
--     Votes arrive in #10; the lock is `name_locked_at`, set by
--     private.lock_proposal_name(), cleared only by
--     private.unlock_proposal_name(), and held by a trigger. See
--     docs/adr/0005-proposal-name-lock.md.
--
-- Any current member reads and adds a meal's proposals, departed members'
-- proposals included. Only the proposer, while still a member, edits one, and
-- only its name and note: the link, coordinates and CID say which restaurant
-- it is, so changing them would swap the restaurant as surely as a new name.

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals (id) on delete cascade,
  -- Filled from the caller, never sent by the client (no grant below). Kept
  -- when they leave the trip; cleared if their account is deleted. The
  -- proposal itself stays: a decision may rest on it, and its name, note and
  -- link describe a restaurant, not the person (decided on #8, ADR 0005).
  proposed_by uuid default auth.uid() references auth.users (id) on delete set null,
  -- Stored already trimmed, like a trip's name, so the length limit is on
  -- what is stored.
  place_name text not null
    check (place_name = btrim(place_name) and char_length(place_name) between 1 and 200),
  -- The Maps link as the member pasted it, never rewritten. It is not used as
  -- an outbound link: the app links out through the official Maps URLs
  -- scheme (https://www.google.com/maps/search/?api=1...), so a pasted link
  -- can never send anyone elsewhere. Still, only http(s) is kept.
  source_url text
    check (
      source_url = btrim(source_url)
      and char_length(source_url) between 1 and 2000
      and source_url ~* '^https?://'
    ),
  -- "No reservation needed", "20 min walk from the hotel". No note is null.
  note text check (note = btrim(note) and char_length(note) between 1 and 1000),
  -- Resolved from source_url by #9. There is no Places `place_id`: short
  -- links do not yield one. The CID is the second half of the `!1s` feature
  -- id pair; its stored form is #9's to settle, hence only a length bound.
  place_cid text check (char_length(place_cid) between 1 and 64),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  -- When the name became read-only: the first vote (#10). Cleared when the
  -- last vote is withdrawn, and only by private.unlock_proposal_name().
  name_locked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);

-- The meal's proposals, oldest first.
create index proposals_meal_id_idx on public.proposals (meal_id, created_at);
-- The account-deletion cascade looks proposals up by proposer.
create index proposals_proposed_by_idx on public.proposals (proposed_by);

-- The name lock ---------------------------------------------------------------------
-- A trigger, so the lock holds on every path: the proposer's edit, the table
-- owner, service_role. Only a caller who can see and edit the row reaches it
-- (RLS filters an UPDATE's rows before its triggers fire), so a stranger or
-- another member never learns from this error that the proposal exists.
--
-- Sending the unchanged name is not a change, so the app may send the name
-- and the note together.
--
-- Clearing the marker is refused unless private.unlock_proposal_name() is
-- doing it: that function names the proposal in a transaction-local setting
-- for the length of its own UPDATE and resets it straight after. No client
-- role can use a forged setting, because none holds UPDATE on name_locked_at
-- (service_role included, see the grants), and PostgREST exposes no way to
-- call set_config. Only the table owner could forge it, and the owner can
-- drop the trigger anyway.
create function private.keep_proposal_name_locked()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.name_locked_at is not null then
    if new.name_locked_at is null
      and coalesce(current_setting('what_to_eat.unlocking_proposal', true), '')
        is distinct from old.id::text
    then
      raise exception 'proposal_name_unlock'
        using errcode = 'P0001',
          hint = 'Only withdrawing the last vote unlocks a proposal''s name.';
    end if;
    if new.place_name is distinct from old.place_name then
      raise exception 'proposal_name_locked'
        using errcode = 'P0001',
          hint = 'Someone has voted on this proposal, so its name can no longer change.';
    end if;
  end if;

  return new;
end;
$$;

create trigger proposals_name_lock
  before update on public.proposals
  for each row execute function private.keep_proposal_name_locked();

-- The hooks for #10. Its vote triggers call these from a SECURITY DEFINER
-- trigger function (the voter holds no grant on name_locked_at, and is
-- usually not the proposer): lock when a proposal gets its first vote, unlock
-- when its last vote is withdrawn. Locking an already locked name keeps the
-- first time, and unlocking an unlocked one does nothing, so each may be
-- called whenever it might apply. See docs/adr/0005-proposal-name-lock.md.
create function private.lock_proposal_name(proposal_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.proposals p
  set name_locked_at = now()
  where p.id = lock_proposal_name.proposal_id
    and p.name_locked_at is null
$$;

create function private.unlock_proposal_name(proposal_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'what_to_eat.unlocking_proposal', unlock_proposal_name.proposal_id::text, true
  );

  update public.proposals p
  set name_locked_at = null
  where p.id = unlock_proposal_name.proposal_id
    and p.name_locked_at is not null;

  -- Nothing later in the transaction may ride on this unlock.
  perform pg_catalog.set_config('what_to_eat.unlocking_proposal', '', true);
end;
$$;

-- RLS ---------------------------------------------------------------------
-- Every policy asks whether the proposal's meal is in a trip the caller is
-- currently in. The meals subquery is itself subject to meals_select, which
-- asks the same; the predicate is written out rather than leaning on that.
--
-- INSERT: a refused insert is 42501 whatever it carries. The WITH CHECK runs
-- before the CHECK constraints and the foreign key, so a stranger cannot tell
-- a real meal id from an invented one by the error.

alter table public.proposals enable row level security;

create policy proposals_select on public.proposals
  for select to authenticated
  using (
    meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
  );

create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (
    proposed_by = (select auth.uid())
    and meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
  );

-- The proposer, while still a member. Anyone else's edit matches no row and
-- raises nothing.
create policy proposals_update on public.proposals
  for update to authenticated
  using (
    proposed_by = (select auth.uid())
    and meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
  )
  with check (
    proposed_by = (select auth.uid())
    and meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
  );

-- No DELETE policy, deliberately.

-- Grants ------------------------------------------------------------------
-- As in the initial migration: take back the Data API's default ALL, then
-- grant exactly what the policies are written for.
--
-- service_role keeps SELECT and gets INSERT and UPDATE on every column but
-- the name lock (the Edge Functions of #9 onwards may need to write), so it
-- can neither lock nor unlock a name, forged setting or not. It holds no
-- DELETE or TRUNCATE: nothing ever deletes a proposal.
--
-- #9 chooses how place_cid, lat and lng are written (a grant here, or filled
-- from its resolution cache); until then no client may write them.

revoke all on public.proposals from anon, authenticated, service_role;
grant select on public.proposals to authenticated, service_role;
grant insert (meal_id, place_name, source_url, note) on public.proposals to authenticated;
grant update (place_name, note) on public.proposals to authenticated;
grant insert (id, meal_id, proposed_by, place_name, source_url, note, place_cid, lat, lng, created_at)
  on public.proposals to service_role;
grant update (place_name, note, place_cid, lat, lng) on public.proposals to service_role;

-- The trigger function needs no grant to fire; the lock and unlock are
-- called only from #10's trigger functions, which run as their owner.
revoke all on function private.keep_proposal_name_locked() from public, anon, authenticated, service_role;
revoke all on function private.lock_proposal_name(uuid) from public, anon, authenticated, service_role;
revoke all on function private.unlock_proposal_name(uuid) from public, anon, authenticated, service_role;
