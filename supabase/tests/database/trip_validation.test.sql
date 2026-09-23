-- What a trip's name and timezone may be, on every write path: create_trip(),
-- an organiser's direct UPDATE, and service_role (server-side code, which
-- bypasses RLS but not constraints or triggers).
begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com');

-- service_role can write trips ----------------------------------------------
-- Nothing on the write path may depend on a grant service_role lacks.

set local role service_role;

select results_eq(
  $$ insert into public.trips (name, timezone) values ('Ops', 'Asia/Tokyo')
     returning name, timezone $$,
  $$ values ('Ops'::text, 'Asia/Tokyo'::text) $$,
  'service_role can insert a trip'
);
select results_eq(
  $$ update public.trips set name = 'Ops 2', timezone = 'Europe/Paris'
     where name = 'Ops'
     returning name, timezone $$,
  $$ values ('Ops 2'::text, 'Europe/Paris'::text) $$,
  'service_role can update a trip''s name and timezone'
);
select throws_ok(
  $$ update public.trips set timezone = 'EST' where name = 'Ops 2' $$,
  '23514', null,
  'service_role is held to the same timezone rule'
);
select throws_ok(
  $$ insert into public.trips (name, timezone) values ('  Ops  ', 'Asia/Tokyo') $$,
  '23514', null,
  'service_role cannot store an untrimmed name'
);

reset role;

-- Names are stored trimmed, and the limit applies to what is stored ----------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ select name from public.create_trip('  Tokyo  ', 'Asia/Tokyo') $$,
  array['Tokyo'],
  'create_trip() stores a padded name trimmed'
);
select results_eq(
  $$ select name from public.create_trip(repeat(' ', 5000) || 'x' || repeat(' ', 5000), 'Asia/Tokyo') $$,
  array['x'],
  'create_trip() does not store padding'
);
select lives_ok(
  $$ select public.create_trip(repeat('x', 100), 'Asia/Tokyo') $$,
  'a 100-character name is accepted'
);
select throws_ok(
  $$ select public.create_trip(repeat('x', 101), 'Asia/Tokyo') $$,
  '23514', null,
  'a name over 100 characters is rejected'
);
select throws_ok(
  $$ select public.create_trip(' ' || repeat('x', 101) || ' ', 'Asia/Tokyo') $$,
  '23514', null,
  'a name over 100 characters after trimming is rejected'
);
select throws_ok(
  $$ update public.trips set name = '  Tokyo  ' where name = 'Tokyo' $$,
  '23514', null,
  'an organiser cannot store a padded name directly'
);
select throws_ok(
  $$ update public.trips set name = repeat(' ', 5000000) || 'x' where name = 'Tokyo' $$,
  '23514', null,
  'an organiser cannot pass a huge value off as a short name'
);

-- Timezones are IANA region/city names ---------------------------------------
-- Guard: the legacy names below are all real entries in this server's tzdata,
-- so rejecting them proves the rule, not merely that the name is unknown.

select is(
  (select count(*) from pg_timezone_names
   where name in ('EST', 'MST', 'HST', 'EST5EDT', 'Etc/GMT-8', 'Etc/UTC', 'UTC')),
  7::bigint,
  'the legacy zones under test exist in pg_timezone_names'
);

select lives_ok(
  $$ select public.create_trip('Tokyo trip', 'Asia/Tokyo') $$,
  'Asia/Tokyo is accepted'
);
select lives_ok(
  $$ select public.create_trip('New York trip', 'America/New_York') $$,
  'America/New_York is accepted'
);
select lives_ok(
  $$ select public.create_trip('Buenos Aires trip', 'America/Argentina/Buenos_Aires') $$,
  'a three-part region name is accepted'
);

select throws_ok(
  $$ select public.create_trip('x', 'EST') $$, '23514', null,
  'the fixed-offset zone EST is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'MST') $$, '23514', null,
  'the fixed-offset zone MST is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'HST') $$, '23514', null,
  'the fixed-offset zone HST is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'EST5EDT') $$, '23514', null,
  'the POSIX-style zone EST5EDT is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'Etc/GMT-8') $$, '23514', null,
  'Etc/GMT-8 is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'Etc/UTC') $$, '23514', null,
  'Etc/UTC is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'UTC') $$, '23514', null,
  'UTC is rejected: a trip takes place somewhere'
);
select throws_ok(
  $$ select public.create_trip('x', 'UTC+8') $$, '23514', null,
  'a POSIX offset is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'JST') $$, '23514', null,
  'an abbreviation is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'posix/Asia/Tokyo') $$, '23514', null,
  'the posix/ copy of a zone is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'right/Asia/Tokyo') $$, '23514', null,
  'the right/ copy of a zone is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'SystemV/EST5') $$, '23514', null,
  'a SystemV/ zone is rejected'
);
select throws_ok(
  $$ select public.create_trip('x', 'Asia/Atlantis') $$, '23514', null,
  'an unknown region/city name is rejected'
);
select throws_ok(
  $$ update public.trips set timezone = 'Etc/GMT-8' where name = 'Tokyo trip' $$,
  '23514', null,
  'an organiser cannot change the timezone to a fixed offset'
);

reset role;

select * from finish();

rollback;
