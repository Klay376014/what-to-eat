-- What each identity can read and change on trips and trip_members.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   departed member of trip A
--   carol  organiser of trip B
--   erin   signed in, in no trip
--
-- Identities are simulated the way PostgREST does it: `role` plus the JWT
-- claims that auth.uid() reads. `reset role` returns to the owner between
-- identities, because anon may not switch to authenticated.
begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '2 days', null);

-- A member reads their trip -------------------------------------------------
-- The positive control: without it, every "cannot read" below would also
-- pass against a policy that hides everything from everyone.

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select name from public.trips $$,
  array['Tokyo'],
  'a member reads their own trip, and only that one'
);

-- trip_members' policy checks membership by reading trip_members. If that
-- check went through the policy again it would recurse until Postgres gives
-- up (42P17 or 54001, depending on how the recursion is reached).
select lives_ok(
  $$ select * from public.trip_members $$,
  'reading trip_members does not recurse through its own policy'
);
select results_eq(
  $$ select user_id from public.trip_members order by user_id $$,
  array[
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid
  ],
  'a member reads the whole membership of their trip, and no other'
);

-- A departed member's row survives and stays readable to the trip -----------

select results_eq(
  $$ select role::text, left_at is not null
     from public.trip_members
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and user_id = '44444444-4444-4444-4444-444444444444' $$,
  $$ values ('member', true) $$,
  'a departed member''s row survives and remains readable to the trip'
);

-- ...but departing ends the departed member's own access.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ select id from public.trips $$,
  'a departed member no longer reads the trip'
);
select is_empty(
  $$ select user_id from public.trip_members $$,
  'a departed member no longer reads the trip''s membership'
);

-- A non-member cannot read a trip -------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ select id from public.trips $$,
  'a signed-in non-member reads no trip'
);
select is_empty(
  $$ select user_id from public.trip_members $$,
  'a signed-in non-member reads no membership'
);
select is_empty(
  $$ select id from public.trips
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a non-member cannot read a trip even by its id'
);

-- A non-member cannot make themselves a member or organiser.
select throws_ok(
  $$ insert into public.trip_members (trip_id, user_id, role) values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       '55555555-5555-5555-5555-555555555555',
       'organiser'
     ) $$,
  '42501', null,
  'a non-member cannot add themselves to a trip'
);

-- A member of one trip cannot read another ----------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select results_eq(
  $$ select name from public.trips $$,
  array['Seoul'],
  'a member of trip B reads trip B'
);
select is_empty(
  $$ select id from public.trips
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a member of trip B cannot read trip A'
);
select is_empty(
  $$ select user_id from public.trip_members
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a member of trip B cannot read trip A''s membership'
);
-- Being an organiser elsewhere confers nothing on trip A.
select is_empty(
  $$ update public.trips set name = 'Hijacked'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning id $$,
  'the organiser of trip B cannot change trip A'
);

-- A member who is not the organiser cannot change trip settings -------------
-- Each denied write is followed by a check, as the owner, that the row it
-- targeted is intact: matching no rows is not proof on its own.

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is_empty(
  $$ update public.trips
     set name = 'Renamed', timezone = 'Europe/London',
         start_date = '2027-01-01', end_date = '2027-01-02'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning id $$,
  'a non-organiser member cannot change trip settings'
);
select is_empty(
  $$ delete from public.trips
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning id $$,
  'a non-organiser member cannot delete the trip'
);
select throws_ok(
  $$ update public.trip_members set role = 'organiser'
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and user_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null,
  'a member cannot promote themselves to organiser'
);

reset role;

select results_eq(
  $$ select name, timezone, start_date, end_date
     from public.trips
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('Tokyo'::text, 'Asia/Tokyo'::text, '2026-10-01'::date, '2026-10-05'::date) $$,
  'the denied writes left trip A''s settings intact'
);
select results_eq(
  $$ select role::text from public.trip_members
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and user_id = '22222222-2222-2222-2222-222222222222' $$,
  array['member'],
  'the denied promotion left the member''s role intact'
);

-- The organiser can change trip settings ------------------------------------
-- Positive control for the denial above.

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ update public.trips
     set name = 'Tokyo & Osaka', end_date = '2026-10-08'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning name, end_date $$,
  $$ values ('Tokyo & Osaka'::text, '2026-10-08'::date) $$,
  'the organiser changes trip settings'
);
select throws_ok(
  $$ update public.trips set timezone = 'Mars/Olympus_Mons'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '23514', null,
  'the organiser cannot set a timezone that is not an IANA name'
);
select throws_ok(
  $$ update public.trips set id = gen_random_uuid()
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null,
  'the organiser cannot rewrite a trip id'
);

-- An unauthenticated caller can read nothing --------------------------------
-- anon holds no grant, so the request stops before any policy runs.

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select * from public.trips $$,
  '42501', null,
  'an unauthenticated caller cannot read trips'
);
select throws_ok(
  $$ select * from public.trip_members $$,
  '42501', null,
  'an unauthenticated caller cannot read trip_members'
);
select throws_ok(
  $$ select * from public.create_trip('Anon trip', 'Asia/Tokyo') $$,
  '42501', null,
  'an unauthenticated caller cannot create a trip'
);
select throws_ok(
  $$ select private.is_trip_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'an unauthenticated caller cannot probe membership'
);

reset role;

select * from finish();

rollback;
