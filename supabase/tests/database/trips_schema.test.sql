-- Shape of the trips/membership schema and who holds which privilege on it.
-- The behavioural RLS checks live in trips_rls.test.sql; this file pins the
-- structure those policies rely on.
begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

-- The abandoned global allowlist is gone -------------------------------------

select hasnt_table('public', 'members', 'the global allowlist table is gone');
select hasnt_function('public', 'is_member', 'the allowlist predicate is gone');
select is_empty(
  $$ select policyname from pg_policies
     where qual ilike '%is_member()%' or with_check ilike '%is_member()%' $$,
  'no policy refers to the allowlist predicate'
);

-- Trips -------------------------------------------------------------------

select has_table('public', 'trips', 'trips exists');
select col_not_null('public', 'trips', 'name', 'a trip has a name');
select col_is_null('public', 'trips', 'start_date', 'a trip start date is optional');
select col_is_null('public', 'trips', 'end_date', 'a trip end date is optional');
select col_type_is('public', 'trips', 'start_date', 'date', 'start_date is a date');
select col_type_is('public', 'trips', 'end_date', 'date', 'end_date is a date');
select col_not_null('public', 'trips', 'timezone', 'a trip has a timezone');

-- Membership --------------------------------------------------------------

select has_table('public', 'trip_members', 'trip_members exists');
select enum_has_labels(
  'public', 'trip_role', array['organiser', 'member'],
  'a membership role is organiser or member'
);
select col_type_is(
  'public', 'trip_members', 'role', 'public', 'trip_role',
  'trip_members.role is a trip_role'
);
select col_is_null(
  'public', 'trip_members', 'left_at',
  'departure is recorded in left_at'
);
select col_is_pk(
  'public', 'trip_members', array['trip_id', 'user_id'],
  'one membership row per user per trip'
);

-- Membership predicates ---------------------------------------------------
-- SECURITY DEFINER is what keeps the trip_members policy from recursing
-- through itself; the empty search_path is what makes that safe.

select is_definer(
  'private', 'my_trip_ids', array[]::text[],
  'my_trip_ids() is security definer'
);
select is_definer(
  'private', 'my_organiser_trip_ids', array[]::text[],
  'my_organiser_trip_ids() is security definer'
);
select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace in ('private'::regnamespace, 'public'::regnamespace)
       and p.prosecdef
       and not ('search_path=""' = any (coalesce(p.proconfig, '{}'))) $$,
  'every security definer function pins an empty search_path'
);

-- Policies ask for the caller's trips once per statement, as a set, rather
-- than calling a predicate with each row's trip id. A private function called
-- with an argument in a policy is that per-row pattern.
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public'
       and coalesce(qual, '') || ' ' || coalesce(with_check, '')
           ~ 'private\.[a-z_]+\([^)]' $$,
  'no policy calls a membership predicate once per row'
);
select cmp_ok(
  (select count(*) from pg_policies
   where schemaname = 'public'
     and tablename in ('trips', 'trip_members')
     and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'private\.my_'),
  '=', 4::bigint,
  'every trips and trip_members policy asks the set-returning helpers'
);

-- Row level security everywhere -------------------------------------------

select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity $$,
  'every table in public has row level security enabled'
);

-- anon holds nothing --------------------------------------------------------
-- Checked across every relation in public, not just the two tables above, so
-- a table added later without its revoke fails here. The count guard stops
-- the check passing vacuously if the catalog query ever matches nothing.

select cmp_ok(
  (select count(*) from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f')),
  '>=', 2::bigint,
  'the anon check below has tables to inspect'
);
select is_empty(
  $$ select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (
         has_table_privilege(
           'anon', c.oid,
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
         )
         or has_any_column_privilege(
           'anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'
         )
       ) $$,
  'anon holds no privilege on any table in public'
);
select table_privs_are(
  'public', 'trips', 'anon', array[]::text[],
  'anon holds no privilege on trips'
);
select table_privs_are(
  'public', 'trip_members', 'anon', array[]::text[],
  'anon holds no privilege on trip_members'
);
select schema_privs_are(
  'private', 'anon', array[]::text[],
  'anon cannot reach the private schema'
);
select function_privs_are(
  'public', 'create_trip', array['text', 'text', 'date', 'date'],
  'anon', array[]::text[],
  'anon cannot create a trip'
);

-- authenticated holds exactly what its policies are written for -------------
-- No INSERT on trips (create_trip() is the only way in), no TRUNCATE anywhere
-- (RLS does not apply to it), and no writes to trip_members yet.

select table_privs_are(
  'public', 'trips', 'authenticated', array['SELECT', 'DELETE'],
  'authenticated may read and delete trips, subject to RLS'
);
select ok(
  has_column_privilege('authenticated', 'public.trips', 'name', 'UPDATE')
    and has_column_privilege('authenticated', 'public.trips', 'start_date', 'UPDATE')
    and has_column_privilege('authenticated', 'public.trips', 'end_date', 'UPDATE')
    and has_column_privilege('authenticated', 'public.trips', 'timezone', 'UPDATE'),
  'authenticated may update trip settings, subject to RLS'
);
select ok(
  not has_column_privilege('authenticated', 'public.trips', 'id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.trips', 'created_at', 'UPDATE'),
  'authenticated may not rewrite a trip id or creation time'
);
select table_privs_are(
  'public', 'trip_members', 'authenticated', array['SELECT'],
  'authenticated may only read trip_members, subject to RLS'
);
-- Policies store their functions by OID and Postgres checks only EXECUTE
-- when they run, so no role needs to look names up in `private`.
select schema_privs_are(
  'private', 'authenticated', array[]::text[],
  'authenticated cannot call the private helpers by name'
);
select function_privs_are(
  'public', 'create_trip', array['text', 'text', 'date', 'date'],
  'authenticated', array['EXECUTE'],
  'authenticated can create a trip'
);

select * from finish();

rollback;
