-- Removing a member, leaving, and handing over the organiser role.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   member of trip A
--   frank  member of trip A, joined last
--   carol  organiser of trip B
--   gina   member of trip B, joined before hank
--   hank   member of trip B
--   erin   signed in, in no trip
begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'gina@example.com'),
  ('88888888-8888-8888-8888-888888888888', 'hank@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '5 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '4 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '4 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '5 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-7777-7777-7777-777777777777', 'member', now() - interval '4 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '88888888-8888-8888-8888-888888888888', 'member', now() - interval '2 days');

-- Only the organiser removes members -------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444') $$,
  '42501', null,
  'a member who is not the organiser cannot remove a member'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select throws_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444') $$,
  '42501', null,
  'the organiser of another trip cannot remove a member of this one'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select throws_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444') $$,
  '42501', null,
  'a stranger cannot remove a member'
);

-- No client write to trip_members exists outside the functions.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ update public.trip_members set left_at = now()
     where user_id = '44444444-4444-4444-4444-444444444444' $$,
  '42501', null,
  'even the organiser cannot write trip_members directly'
);
select throws_ok(
  $$ delete from public.trip_members
     where user_id = '44444444-4444-4444-4444-444444444444' $$,
  '42501', null,
  'nobody can delete a membership row, so departures always leave it in place'
);

reset role;
select results_eq(
  $$ select left_at is null from public.trip_members
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and user_id = '44444444-4444-4444-4444-444444444444' $$,
  array[true],
  'the refused removals left the member in the trip'
);

-- The organiser removes a member -----------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444') $$,
  'the organiser removes a member'
);
select throws_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444') $$,
  'P0001', 'not_a_member',
  'a member who has already gone cannot be removed again'
);
select throws_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555') $$,
  'P0001', 'not_a_member',
  'someone who was never in the trip cannot be removed'
);
select throws_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111') $$,
  'P0001', 'organiser_must_transfer',
  'the organiser cannot remove themselves; they must hand over the role first'
);

-- The removed member's row survives and stays readable to the trip...
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select role::text, left_at is not null from public.trip_members
     where user_id = '44444444-4444-4444-4444-444444444444' $$,
  $$ values ('member'::text, true) $$,
  'a removed member''s row survives and stays readable to the trip'
);

-- ...but the removed member loses access at once.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ select id from public.trips $$,
  'a removed member no longer reads the trip'
);
select is_empty(
  $$ select user_id from public.trip_members $$,
  'a removed member no longer reads the trip''s membership'
);
select throws_ok(
  $$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'P0001', 'not_a_member',
  'a removed member cannot leave again'
);

-- A member leaves ---------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select lives_ok(
  $$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'a member leaves the trip'
);
select is_empty(
  $$ select id from public.trips $$,
  'a member who left no longer reads the trip'
);
select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a member who left cannot invite'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ select left_at is not null from public.trip_members
     where user_id = '22222222-2222-2222-2222-222222222222' $$,
  array[true],
  'a member who left keeps their row, readable to the trip'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select throws_ok(
  $$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'P0001', 'not_a_member',
  'someone not in the trip cannot leave it'
);

-- The organiser cannot leave without handing over ------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'P0001', 'organiser_must_transfer',
  'the organiser trying to leave is told to hand over the role first'
);
select results_eq(
  $$ select role::text, left_at is null from public.trip_members
     where user_id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('organiser'::text, true) $$,
  'the refused departure left the organiser in place'
);

-- Handing over the organiser role ------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select throws_ok(
  $$ select public.transfer_organiser('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666') $$,
  '42501', null,
  'a member cannot make themselves the organiser'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select throws_ok(
  $$ select public.transfer_organiser('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666') $$,
  '42501', null,
  'the organiser of another trip cannot hand over this one'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ select public.transfer_organiser('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555') $$,
  'P0001', 'not_a_member',
  'the role cannot go to someone outside the trip'
);
select throws_ok(
  $$ select public.transfer_organiser('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444') $$,
  'P0001', 'not_a_member',
  'the role cannot go to a member who has left'
);
select lives_ok(
  $$ select public.transfer_organiser('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666') $$,
  'the organiser hands the role to a current member'
);
select results_eq(
  $$ select user_id, role::text from public.trip_members
     where left_at is null order by user_id $$,
  $$ values
       ('11111111-1111-1111-1111-111111111111'::uuid, 'member'::text),
       ('66666666-6666-6666-6666-666666666666'::uuid, 'organiser'::text) $$,
  'after the hand-over, the new organiser holds the role and the old one is a member'
);
select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'the former organiser can no longer invite'
);
select lives_ok(
  $$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'once the role is handed over, the former organiser can leave'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select lives_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'the new organiser can invite'
);
select results_eq(
  $$ update public.trips set name = 'Tokyo again'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning name $$,
  array['Tokyo again'],
  'the new organiser can change the trip settings'
);
select throws_ok(
  $$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'P0001', 'organiser_must_transfer',
  'the only member left is the organiser, and still cannot just leave'
);

-- An unauthenticated caller can do none of it -------------------------------------

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select public.remove_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-7777-7777-7777-777777777777') $$,
  '42501', null,
  'an unauthenticated caller cannot remove a member'
);
select throws_ok(
  $$ select public.leave_trip('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  '42501', null,
  'an unauthenticated caller cannot leave a trip'
);
select throws_ok(
  $$ select public.transfer_organiser('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '77777777-7777-7777-7777-777777777777') $$,
  '42501', null,
  'an unauthenticated caller cannot hand over a trip'
);

-- A deleted organiser account never leaves a trip without an organiser ---------
-- Deleting an auth user cascades to their membership rows. If the organiser's
-- row went with no successor, nobody could ever edit, invite to or delete the
-- trip again. The longest-standing current member takes over instead.

reset role;

delete from auth.users where id = '33333333-3333-3333-3333-333333333333';

select results_eq(
  $$ select user_id, role::text from public.trip_members
     where trip_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' order by user_id $$,
  $$ values
       ('77777777-7777-7777-7777-777777777777'::uuid, 'organiser'::text),
       ('88888888-8888-8888-8888-888888888888'::uuid, 'member'::text) $$,
  'when the organiser''s account is deleted, the longest-standing member becomes organiser'
);

-- The sole organiser's account going leaves an empty trip, not an error.
delete from auth.users where id = '66666666-6666-6666-6666-666666666666';
select is_empty(
  $$ select user_id from public.trip_members
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and left_at is null $$,
  'deleting the account of a trip''s only current member leaves no one to promote, and no error'
);

-- Deleting a trip still takes its memberships with it.
select lives_ok(
  $$ delete from public.trips where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'deleting a trip still works with the hand-over trigger in place'
);
select is_empty(
  $$ select user_id from public.trip_members
     where trip_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  'deleting a trip removes its memberships'
);

select * from finish();

rollback;
