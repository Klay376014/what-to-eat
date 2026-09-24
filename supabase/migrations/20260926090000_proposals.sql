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
--   - The name locks once anyone has voted. Otherwise a +1 for a noodle shop
--     could be turned into a +1 for somewhere nobody agreed to. Votes arrive
--     in #10; the lock is `name_locked_at`, set by private.lock_proposal_name()
--     and held by a trigger. See docs/adr/0005-proposal-name-lock.md.
--
-- Any current member reads and adds a meal's proposals, departed members'
-- proposals included. Only the proposer, while still a member, edits one, and
-- only its name and note: the link, coordinates and CID say which restaurant
-- it is, so changing them would swap the restaurant as surely as a new name.

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals (id) on delete cascade,
  -- Filled from the caller, never sent by the client (no grant below). Kept
  -- when they leave the trip; cleared if their account is deleted, so the
  -- proposal, which a decision may rest on, outlives the account.
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
  -- When the name became read-only: the first vote (#10). Never cleared.
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
create function private.keep_proposal_name_locked()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.name_locked_at is not null then
    if new.name_locked_at is null then
      raise exception 'proposal_name_unlock'
        using errcode = 'P0001',
          hint = 'A proposal''s name, once locked by a vote, stays locked.';
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

-- The hook for #10. Its trigger on a new vote calls this with the vote's
-- proposal, from a SECURITY DEFINER trigger function (the voter holds no
-- grant on name_locked_at, and is usually not the proposer). Locking an
-- already locked name keeps the first time, so every vote may call it.
--
-- The lock is sticky: withdrawing the last vote does not unlock the name.
-- See docs/adr/0005-proposal-name-lock.md.
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
-- grant exactly what the policies are written for. service_role keeps its
-- defaults (the Edge Functions of #9 onwards may need to read and write),
-- except DELETE and TRUNCATE: nothing ever deletes a proposal.
--
-- #9 chooses how place_cid, lat and lng are written (a grant here, or filled
-- from its resolution cache); until then no client may write them.

revoke all on public.proposals from anon, authenticated;
revoke delete, truncate on public.proposals from service_role;
grant select on public.proposals to authenticated;
grant insert (meal_id, place_name, source_url, note) on public.proposals to authenticated;
grant update (place_name, note) on public.proposals to authenticated;

-- The trigger function needs no grant to fire; the lock is called only from
-- #10's trigger function, which runs as its owner.
revoke all on function private.keep_proposal_name_locked() from public, anon, authenticated, service_role;
revoke all on function private.lock_proposal_name(uuid) from public, anon, authenticated, service_role;
