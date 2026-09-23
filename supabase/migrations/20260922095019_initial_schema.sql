-- Trips and per-trip membership.
--
-- Access model: the app is open to anyone with a Google account, so RLS is the
-- boundary between strangers. Every policy asks "is the caller a current
-- member (or the organiser) of *this* trip", never "is the caller a known
-- user". Meals, proposals, votes and decisions hang off trips in later
-- migrations and reuse the same predicates.
--
-- Grants are stated table by table: each table first has every privilege
-- revoked from anon and authenticated (the Data API's default privileges hand
-- both roles ALL, TRUNCATE included, which RLS does not cover), then
-- authenticated gets exactly what its policies are written for.

-- Helpers live in `private`, which is not in [api].schemas, so PostgREST
-- never exposes them as RPC endpoints. authenticated needs USAGE because
-- policies and CHECK constraints run with the caller's privileges.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.trip_role as enum ('organiser', 'member');

-- True for a zone name in the IANA tz database ('Asia/Tokyo'), false for
-- abbreviations and POSIX offsets ('JST', 'UTC+8') that `at time zone` would
-- also accept but that do not follow DST rules.
create function private.is_iana_timezone(tz text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz)
$$;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  -- Both or neither: a trip without dates is the "where are we eating
  -- tonight" daily-use case.
  start_date date,
  end_date date,
  -- Single source of truth for every time the app renders or writes for this
  -- trip. Never the browser's or the user's own timezone.
  timezone text not null check (private.is_iana_timezone(timezone)),
  created_at timestamptz not null default now(),
  check ((start_date is null) = (end_date is null)),
  check (end_date >= start_date)
);

-- A departure sets `left_at` instead of deleting the row, so a departed
-- member's proposals and votes keep pointing at a membership that exists.
create table public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.trip_role not null default 'member',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (trip_id, user_id),
  check (left_at is null or left_at >= joined_at),
  -- The organiser must transfer the role before leaving.
  check (not (role = 'organiser' and left_at is not null))
);

-- Exactly one organiser per trip is maintained by create_trip() and, later,
-- the transfer flow; this index guarantees there is never more than one.
create unique index trip_members_one_organiser_idx
  on public.trip_members (trip_id) where role = 'organiser';

-- "Which trips am I in" lookups; the primary key only serves trip_id-first.
create index trip_members_user_id_idx on public.trip_members (user_id);

-- Membership predicates ---------------------------------------------------
-- SECURITY DEFINER so they read trip_members as its owner, bypassing RLS.
-- The trip_members SELECT policy itself calls is_trip_member(); as an
-- invoker function its own read of trip_members would apply that policy
-- again, calling itself for every row until the stack limit is hit. Security
-- definer functions are also never inlined, so the planner cannot fold the
-- body back into the policy. An empty search_path means nothing in the body
-- can be hijacked by objects the caller creates. Both only ever answer about
-- auth.uid(), so a caller cannot probe anyone else's membership. They live in
-- `private`, so they are not callable as RPCs, only from policies.

-- Current member: departed members lose access to the trip.
create function private.is_trip_member(trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members m
    where m.trip_id = is_trip_member.trip_id
      and m.user_id = (select auth.uid())
      and m.left_at is null
  )
$$;

create function private.is_trip_organiser(trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members m
    where m.trip_id = is_trip_organiser.trip_id
      and m.user_id = (select auth.uid())
      and m.role = 'organiser'
      and m.left_at is null
  )
$$;

-- Creating a trip -------------------------------------------------------------
-- An RPC rather than an AFTER INSERT trigger on trips. With a trigger, the
-- client's `insert ... returning` (supabase-js `.insert().select()`) is
-- checked against the trips SELECT policy before the trigger has added the
-- membership, so it fails; working around that means either a client-chosen
-- id with no RETURNING or a creator clause in the SELECT policy that would
-- keep a departed creator reading the trip. The function inserts both rows in
-- one transaction and returns the trip, and trips has no INSERT grant at all,
-- so there is no path that creates a trip without its organiser.
create function public.create_trip(
  name text,
  timezone text,
  start_date date default null,
  end_date date default null
)
returns public.trips
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  trip public.trips;
begin
  if caller is null then
    raise exception 'create_trip requires a signed-in user'
      using errcode = '42501';
  end if;

  insert into public.trips (name, timezone, start_date, end_date)
  values (
    create_trip.name,
    create_trip.timezone,
    create_trip.start_date,
    create_trip.end_date
  )
  returning * into trip;

  insert into public.trip_members (trip_id, user_id, role)
  values (trip.id, caller, 'organiser');

  return trip;
end;
$$;

-- RLS ---------------------------------------------------------------------

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;

create policy trips_select on public.trips
  for select to authenticated
  using (private.is_trip_member(id));

-- Trip settings (name, dates, timezone) and deletion are organiser-only.
create policy trips_update on public.trips
  for update to authenticated
  using (private.is_trip_organiser(id))
  with check (private.is_trip_organiser(id));

create policy trips_delete on public.trips
  for delete to authenticated
  using (private.is_trip_organiser(id));

-- Members see everyone who is or was in the trip, departed members included,
-- so "proposed by" still resolves after someone leaves. Joining, leaving,
-- removal and role transfer arrive with their own flows; until then no
-- client write is granted.
create policy trip_members_select on public.trip_members
  for select to authenticated
  using (private.is_trip_member(trip_id));

-- Grants ------------------------------------------------------------------

revoke all on public.trips from anon, authenticated;
grant select, delete on public.trips to authenticated;
grant update (name, start_date, end_date, timezone) on public.trips
  to authenticated;

revoke all on public.trip_members from anon, authenticated;
grant select on public.trip_members to authenticated;

-- Postgres grants EXECUTE to PUBLIC by default, and the Data API's default
-- privileges add anon and authenticated for functions in public.
revoke all on function private.is_iana_timezone(text) from public, anon, authenticated;
revoke all on function private.is_trip_member(uuid) from public, anon, authenticated;
revoke all on function private.is_trip_organiser(uuid) from public, anon, authenticated;
revoke all on function public.create_trip(text, text, date, date) from public, anon, authenticated;

grant execute on function private.is_iana_timezone(text) to authenticated;
grant execute on function private.is_trip_member(uuid) to authenticated;
grant execute on function private.is_trip_organiser(uuid) to authenticated;
grant execute on function public.create_trip(text, text, date, date) to authenticated;
