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
-- never exposes them as RPC endpoints. No role gets USAGE on it: a policy
-- stores the function it calls by OID, and at run time Postgres checks only
-- EXECUTE on that function (schema USAGE governs looking a name up), and a
-- trigger's function needs no privilege at all from the role that fires it.
-- So nobody can call these by name, and the policies and trigger still work.
create schema private;
revoke all on schema private from public;

create type public.trip_role as enum ('organiser', 'member');

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  -- Stored already trimmed, so the length limit is on what is stored rather
  -- than on a trimmed view of it (padding cannot smuggle a huge value past
  -- it). create_trip() trims; a direct UPDATE must send a trimmed name.
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  -- Both or neither: a trip without dates is the "where are we eating
  -- tonight" daily-use case.
  start_date date,
  end_date date,
  -- Single source of truth for every time the app renders or writes for this
  -- trip. Never the browser's or the user's own timezone. Validated by the
  -- trips_timezone trigger below.
  timezone text not null,
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

-- Timezone validation ------------------------------------------------------
-- A trip happens somewhere, so its timezone must be a region/city name from
-- the IANA tz database ('Asia/Tokyo', 'America/New_York'). Rejected, although
-- Postgres would accept them for `at time zone`:
--   - abbreviations and POSIX rules: 'JST', 'UTC+8', 'EST5EDT'
--   - legacy fixed-offset zones: 'EST', 'MST', 'HST'
--   - Etc/ zones, including 'Etc/GMT-8' (the sign is inverted) and 'Etc/UTC'
--   - the posix/, right/ and SystemV/ copies of the database
--   - 'UTC' itself, deliberately: no trip takes place in UTC.
--
-- A trigger rather than a CHECK: pg_timezone_names reflects the server's
-- tzdata, which can drop or rename zones on an upgrade. A CHECK is re-run on
-- every row when a dump is restored, so a zone that disappeared would make
-- the restore fail; a trigger runs only when a row is written with a new
-- timezone. Trigger functions also need no EXECUTE grant from the role whose
-- statement fires them, so service_role writes pass without extra grants.
create function private.check_trip_timezone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.timezone like '%/%'
    and new.timezone not like 'Etc/%'
    and new.timezone not like 'posix/%'
    and new.timezone not like 'right/%'
    and new.timezone not like 'SystemV/%'
    and exists (
      select 1 from pg_catalog.pg_timezone_names where name = new.timezone
    )
  then
    return new;
  end if;

  raise exception 'trip timezone must be an IANA region/city name, got %',
    new.timezone
    using errcode = 'check_violation',
      table = 'trips',
      column = 'timezone';
end;
$$;

create trigger trips_timezone
  before insert or update of timezone on public.trips
  for each row execute function private.check_trip_timezone();

-- Membership predicates ---------------------------------------------------
-- Set-returning, so a policy reads `trip_id in (select private.my_trip_ids())`:
-- an uncorrelated subquery Postgres runs once per statement and hashes,
-- instead of calling a function once for every row it scans.
--
-- SECURITY DEFINER so they read trip_members as its owner, bypassing RLS.
-- The trip_members SELECT policy itself asks my_trip_ids(); as an invoker
-- function its own read of trip_members would apply that policy again,
-- recursing until Postgres gives up. Security definer functions are never
-- inlined, so the planner cannot fold the body back into the policy either.
-- An empty search_path means nothing in the body can be hijacked by objects
-- the caller creates. Both answer only about auth.uid(), so a caller cannot
-- probe anyone else's membership.

-- Trips the caller currently belongs to; departed members lose access.
create function private.my_trip_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.trip_id
  from public.trip_members m
  where m.user_id = (select auth.uid())
    and m.left_at is null
$$;

-- Trips the caller currently organises.
create function private.my_organiser_trip_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.trip_id
  from public.trip_members m
  where m.user_id = (select auth.uid())
    and m.role = 'organiser'
    and m.left_at is null
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
    btrim(create_trip.name),
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
  using (id in (select private.my_trip_ids()));

-- Trip settings (name, dates, timezone) and deletion are organiser-only.
create policy trips_update on public.trips
  for update to authenticated
  using (id in (select private.my_organiser_trip_ids()))
  with check (id in (select private.my_organiser_trip_ids()));

create policy trips_delete on public.trips
  for delete to authenticated
  using (id in (select private.my_organiser_trip_ids()));

-- Members see everyone who is or was in the trip, departed members included,
-- so "proposed by" still resolves after someone leaves. Joining, leaving,
-- removal and role transfer arrive with their own flows; until then no
-- client write is granted.
create policy trip_members_select on public.trip_members
  for select to authenticated
  using (trip_id in (select private.my_trip_ids()));

-- Grants ------------------------------------------------------------------

revoke all on public.trips from anon, authenticated;
grant select, delete on public.trips to authenticated;
grant update (name, start_date, end_date, timezone) on public.trips
  to authenticated;

revoke all on public.trip_members from anon, authenticated;
grant select on public.trip_members to authenticated;

-- Postgres grants EXECUTE to PUBLIC by default, and the Data API's default
-- privileges add anon, authenticated and service_role for functions in public.
--
-- The policy predicates need EXECUTE for authenticated, the only role the
-- policies apply to (service_role bypasses RLS). The trigger function needs
-- nothing. Nothing on a trips or trip_members write path is gated on a grant
-- service_role lacks.
revoke all on function private.check_trip_timezone() from public, anon, authenticated, service_role;
revoke all on function private.my_trip_ids() from public, anon, authenticated, service_role;
revoke all on function private.my_organiser_trip_ids() from public, anon, authenticated, service_role;
revoke all on function public.create_trip(text, text, date, date) from public, anon, authenticated;

grant execute on function private.my_trip_ids() to authenticated;
grant execute on function private.my_organiser_trip_ids() to authenticated;
grant execute on function public.create_trip(text, text, date, date) to authenticated;
