-- Decisions: the restaurant a meal is going to (#11).
--
-- Any member decides a meal by choosing one of its proposals. With three
-- people a 1:1:1 split is the normal case, so someone has to be able to call
-- it, and waiting for the organiser to be online would strand the group on a
-- street corner.
--
-- Changing a decision is held to a higher bar than making one: only the
-- member who made it, or the organiser, changes or clears it, so decisions
-- do not get flipped back and forth. A changed decision is a new decision by
-- whoever changed it: it is recorded as theirs, made then.
--
-- The schema, not the app, holds the two structural rules:
--   - One decision per meal: the meal is the primary key.
--   - The chosen proposal belongs to the meal being decided: one composite
--     foreign key on (proposal_id, meal_id) to the proposal's (id, meal_id).
--
-- A decided restaurant also keeps its name, as a voted-on one does (ADR
-- 0005): otherwise its proposer could turn the decided noodle shop into
-- somewhere nobody chose.
--
-- Writing the decision to a calendar is #12's, separately. A decision is a
-- database fact first.

-- The composite foreign key needs a key to point at. `id` is already unique,
-- so this adds no rule, only the target.
alter table public.proposals
  add constraint proposals_id_meal_id_key unique (id, meal_id);

create table public.decisions (
  meal_id uuid primary key references public.meals (id) on delete cascade,
  proposal_id uuid not null,
  -- Filled from the caller, never sent by the client (no grant below), and
  -- refreshed when the decision is changed. Cleared if their account is
  -- deleted; the decision stays, as a proposal outlives its proposer.
  decided_by uuid default auth.uid() references auth.users (id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint decisions_proposal_fkey foreign key (proposal_id, meal_id)
    references public.proposals (id, meal_id) on delete cascade
);

-- The account-deletion cascade looks decisions up by decider; the composite
-- foreign key is checked from the proposal's side by proposal.
create index decisions_decided_by_idx on public.decisions (decided_by);
create index decisions_proposal_idx on public.decisions (proposal_id, meal_id);

-- Deciding and changing -----------------------------------------------------------
-- Before a decision is written, the chosen proposal's row is locked, so a
-- rename of that proposal and the decision take turns: the rename either
-- lands before the decision, or waits and then meets the decided-name rule
-- below. FOR NO KEY UPDATE, as in the votes triggers: the foreign key check
-- takes KEY SHARE, which it does not conflict with.
--
-- When the proposal changes, the decision becomes the changer's, as of now.
-- Changing nothing (or only what a client cannot write) keeps it as it was.
--
-- SECURITY DEFINER, owned by the migration role: locking a row goes through
-- the proposals UPDATE policy, which only the proposer passes, so as the
-- caller the lock would silently match nothing for anyone else. It reads
-- only the one proposal the decision names.
create function private.prepare_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.proposals p where p.id = new.proposal_id for no key update;

  if tg_op = 'UPDATE' and new.proposal_id is distinct from old.proposal_id then
    new.decided_by := (select auth.uid());
    new.decided_at := now();
  end if;

  return new;
end;
$$;

create trigger decisions_prepare
  before insert or update on public.decisions
  for each row execute function private.prepare_decision();

-- A decided restaurant keeps its name ------------------------------------------------
-- For every role, like the vote lock. Sending the unchanged name is not a
-- change, so the note stays editable. SECURITY DEFINER so the check sees the
-- decision whoever renames, whatever they may read.
create function private.keep_decided_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.place_name is distinct from old.place_name
    and exists (select 1 from public.decisions d where d.proposal_id = old.id)
  then
    raise exception 'proposal_decided'
      using errcode = 'P0001',
        hint = 'This restaurant was decided on, so its name can no longer change.';
  end if;

  return new;
end;
$$;

create trigger proposals_decided_name
  before update on public.proposals
  for each row execute function private.keep_decided_name();

-- RLS ---------------------------------------------------------------------
-- Every policy asks whether the decision's meal is in a trip the caller is
-- currently in, written out as in the earlier migrations. Changing and
-- clearing also ask that the caller made the decision or organises the trip.
--
-- An UPDATE's WITH CHECK runs after the BEFORE trigger has made the decision
-- the caller's, so an organiser's change passes it as their own.
--
-- INSERT: a refused insert is 42501 whatever it carries. The WITH CHECK runs
-- before the uniqueness and the foreign key, so a stranger cannot tell which
-- meals exist, or which are decided, by the error.

alter table public.decisions enable row level security;

create policy decisions_select on public.decisions
  for select to authenticated
  using (
    meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
  );

create policy decisions_insert on public.decisions
  for insert to authenticated
  with check (
    decided_by = (select auth.uid())
    and meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
  );

create policy decisions_update on public.decisions
  for update to authenticated
  using (
    meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
    and (
      decided_by = (select auth.uid())
      or meal_id in (
        select m.id from public.meals m
        where m.trip_id in (select private.my_organiser_trip_ids())
      )
    )
  )
  with check (
    decided_by = (select auth.uid())
    and meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
  );

create policy decisions_delete on public.decisions
  for delete to authenticated
  using (
    meal_id in (
      select m.id from public.meals m
      where m.trip_id in (select private.my_trip_ids())
    )
    and (
      decided_by = (select auth.uid())
      or meal_id in (
        select m.id from public.meals m
        where m.trip_id in (select private.my_organiser_trip_ids())
      )
    )
  );

-- Grants ------------------------------------------------------------------
-- As in the earlier migrations: take back the Data API's default ALL, then
-- grant exactly what the policies are written for. A member writes the meal
-- and the proposal when deciding, and only the proposal when changing; who
-- and when are the database's.
--
-- service_role reads decisions (the calendar sync and email of #12 onwards
-- need them) and makes none: a decision is always a member's.

revoke all on public.decisions from anon, authenticated, service_role;
grant select on public.decisions to authenticated, service_role;
grant insert (meal_id, proposal_id) on public.decisions to authenticated;
grant update (proposal_id) on public.decisions to authenticated;
grant delete on public.decisions to authenticated;

revoke all on function private.prepare_decision() from public, anon, authenticated, service_role;
revoke all on function private.keep_decided_name() from public, anon, authenticated, service_role;
