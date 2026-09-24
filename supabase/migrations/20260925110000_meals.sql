-- Meals: the slots of a trip's days that the group plans (#7).
--
-- A meal is a trip's breakfast, lunch, dinner or "other" on one date.
-- Breakfast, lunch and dinner happen at most once a day, so two competing
-- threads for the same dinner cannot exist. "Other" (afternoon tea, a
-- late-night snack, an airport last meal) repeats freely, each with its own
-- label, in the order the meals were added.
--
-- Every meal has a real date, undated trips included: an everyday trip's
-- question is "where are we eating tonight", which needs a day
-- (docs/adr/0003-trip-grid-layout.md). That is what lets the grid show every
-- meal of an undated trip, so clearing a trip's dates never hides one.
--
-- Proposals, votes and decisions hang off meals in later migrations and use
-- the same membership predicates.

create type public.meal_slot as enum ('breakfast', 'lunch', 'dinner', 'other');

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  date date not null,
  slot public.meal_slot not null,
  -- What an "other" meal is called ("Afternoon tea"). Breakfast, lunch and
  -- dinner are named by their slot and carry none. Stored already trimmed,
  -- like a trip's name, so the length limit is on what is stored.
  label text check (label = btrim(label) and char_length(label) between 1 and 60),
  -- The meal's place in its day. Only "other" meals share a slot, so this is
  -- what keeps their order stable. It comes from an identity, so it only ever
  -- grows: a meal added later sorts later, concurrent adds cannot collide,
  -- and no client gets to pick it (GENERATED ALWAYS, and no grant below).
  position bigint generated always as identity,
  created_at timestamptz not null default now(),
  check ((slot = 'other') = (label is not null))
);

-- At most one breakfast, lunch and dinner per trip and day. "Other" is left
-- out of the index, so it repeats.
create unique index meals_one_fixed_slot_per_day_idx
  on public.meals (trip_id, date, slot)
  where slot <> 'other';

-- The grid reads a trip's meals by day.
create index meals_trip_id_date_idx on public.meals (trip_id, date, position);

-- A dated trip's meals fall on its days --------------------------------------
-- Checked when a meal is written, not afterwards: when the organiser later
-- changes the dates, meals that now fall outside are kept, and the app warns
-- about them instead (PRD stories 8 and 9, #5). A CHECK cannot read the trip,
-- hence a trigger.
--
-- SECURITY INVOKER, so the trip is read through its own policy. For a caller
-- who cannot see the trip the trigger lets the row through, and the INSERT
-- policy (checked after BEFORE triggers) refuses it with the same 42501 a
-- non-member always gets. Were this rule reported first, a stranger could
-- probe a trip's dates through the error code. The uniqueness index is
-- checked after the policy, so it reveals nothing either.
create function private.check_meal_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  trip_start date;
  trip_end date;
begin
  select t.start_date, t.end_date
  into trip_start, trip_end
  from public.trips t
  where t.id = new.trip_id;

  if trip_start is null or new.date between trip_start and trip_end then
    return new;
  end if;

  raise exception 'meal date % is outside the trip''s dates (% to %)',
    new.date, trip_start, trip_end
    using errcode = 'check_violation',
      table = 'meals',
      column = 'date';
end;
$$;

create trigger meals_date_in_trip
  before insert or update of date, trip_id on public.meals
  for each row execute function private.check_meal_date();

-- RLS ---------------------------------------------------------------------
-- Any current member reads and adds the trip's meals; a departed member and
-- a stranger do neither. Moving, renaming and removing meals are not granted:
-- the grid does not offer them, and a meal's proposals and decision will
-- hang off it.

alter table public.meals enable row level security;

create policy meals_select on public.meals
  for select to authenticated
  using (trip_id in (select private.my_trip_ids()));

create policy meals_insert on public.meals
  for insert to authenticated
  with check (trip_id in (select private.my_trip_ids()));

-- Grants ------------------------------------------------------------------
-- As in the initial migration: take back the Data API's default ALL, then
-- grant exactly what the policies are written for.

revoke all on public.meals from anon, authenticated;
grant select on public.meals to authenticated;
grant insert (trip_id, date, slot, label) on public.meals to authenticated;

-- The trigger function needs no grant to fire.
revoke all on function private.check_meal_date() from public, anon, authenticated, service_role;
