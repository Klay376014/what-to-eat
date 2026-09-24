-- Invitation links: who can issue and revoke them, and what opening one does.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   departed member of trip A (left yesterday)
--   gina   departed member of trip A (left yesterday)
--   carol  organiser of trip B
--   erin   signed in, in no trip
--   frank  signed in, in no trip
--
-- Invitations to trip A, all inserted as the owner:
--   valid     issued yesterday, expires in 6 days
--   fresh     issued a minute ago, expires in 7 days
--   expired   issued 8 days ago, expired yesterday
--   revoked   issued an hour ago, revoked half an hour ago
--
-- Identities are simulated the way PostgREST does it: `role` plus the JWT
-- claims that auth.uid() reads. `reset role` returns to the owner between
-- identities.
begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'gina@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '3 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '3 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '3 days', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', 'member', now() - interval '3 days', now() - interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '3 days', null);

insert into public.invitations (id, trip_id, token, created_by, created_at, expires_at, revoked_at) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   repeat('v', 43), '11111111-1111-1111-1111-111111111111',
   now() - interval '1 day', now() + interval '6 days', null),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   repeat('f', 43), '11111111-1111-1111-1111-111111111111',
   now() - interval '1 minute', now() - interval '1 minute' + interval '7 days', null),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   repeat('x', 43), '11111111-1111-1111-1111-111111111111',
   now() - interval '8 days', now() - interval '1 day', null),
  ('a0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   repeat('r', 43), '11111111-1111-1111-1111-111111111111',
   now() - interval '1 hour', now() - interval '1 hour' + interval '7 days', now() - interval '30 minutes');

-- The organiser issues a link ------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ select trip_id, created_by, revoked_at is null
     from public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, true) $$,
  'the organiser issues an invitation to their trip'
);

-- 43 base64url characters carry 256 random bits. Anything shorter, or drawn
-- from a smaller alphabet, would be guessable sooner.
select ok(
  (select token ~ '^[A-Za-z0-9_-]{43}$'
   from public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'an invitation token is 43 url-safe characters (256 random bits)'
);
select is(
  (select count(distinct (i).token)::int
   from (select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') as i
         from generate_series(1, 50)) s),
  50,
  'fifty invitations get fifty different tokens'
);
select is(
  (select count(distinct left((i).token, 6))::int
   from (select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') as i
         from generate_series(1, 50)) s),
  50,
  'tokens do not share a predictable prefix'
);
select is(
  (select expires_at - created_at
   from public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  interval '7 days',
  'an invitation expires 7 days after it is issued'
);
select ok(
  (select count(*) >= 4 from public.invitations
   where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'the organiser reads their trip''s invitations'
);

-- The token and expiry are the database's to choose, never the client's.
select throws_ok(
  $$ insert into public.invitations (trip_id, token, created_by) values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('a', 43),
       '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'even the organiser cannot insert an invitation with a token of their choosing'
);
select throws_ok(
  $$ update public.invitations set expires_at = now() + interval '1 year'
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'even the organiser cannot extend an invitation'
);

reset role;
select throws_ok(
  $$ insert into public.invitations (trip_id, token, created_at, expires_at) values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('l', 43), now(), now() + interval '8 days') $$,
  '23514', null,
  'no invitation, however written, lives longer than 7 days'
);
select throws_ok(
  $$ insert into public.invitations (trip_id, token) values (
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'short') $$,
  '23514', null,
  'no invitation, however written, carries a short token'
);

-- Nobody else issues or reads links ------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a member who is not the organiser cannot issue an invitation'
);
select is_empty(
  $$ select token from public.invitations $$,
  'a member who is not the organiser cannot read the trip''s invitation tokens'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'the organiser of another trip cannot issue an invitation to this one'
);
select is_empty(
  $$ select token from public.invitations $$,
  'the organiser of another trip cannot read this trip''s invitations'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a departed member cannot issue an invitation'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a stranger cannot issue an invitation'
);
select throws_ok(
  $$ select public.create_invitation(null) $$,
  '42501', null,
  'an invitation to no trip is refused, not issued'
);

-- Opening a valid link joins the trip ----------------------------------------
-- erin is a stranger until she opens the link.

select is_empty(
  $$ select id from public.trips $$,
  'before joining, the invitee reads no trip'
);
select results_eq(
  $$ select trip_id, joined from public.join_trip(repeat('v', 43)) $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, true) $$,
  'opening a valid link joins the trip and answers with its id'
);
select results_eq(
  $$ select name from public.trips $$,
  array['Tokyo'],
  'the new member reads the trip'
);
select results_eq(
  $$ select role::text, left_at is null from public.trip_members
     where user_id = '55555555-5555-5555-5555-555555555555' $$,
  $$ values ('member'::text, true) $$,
  'the invitee joins as an ordinary member'
);

-- Joining late hides nothing that came before: the new member sees who has
-- already left, as well as who is still here.
select results_eq(
  $$ select user_id from public.trip_members order by user_id $$,
  array[
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid,
    '55555555-5555-5555-5555-555555555555'::uuid,
    '77777777-7777-7777-7777-777777777777'::uuid
  ],
  'a member who joined late sees the whole membership, including those who left before'
);

-- Opening it again is not an error: it just takes the member in.
select results_eq(
  $$ select trip_id, joined from public.join_trip(repeat('v', 43)) $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, false) $$,
  'opening the link again as a member answers with the trip, without error'
);
select is(
  (select count(*)::int from public.trip_members
   where user_id = '55555555-5555-5555-5555-555555555555'),
  1,
  'opening the link again does not add a second membership'
);

-- The organiser opening their own link keeps their role.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ select trip_id, joined from public.join_trip(repeat('v', 43)) $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, false) $$,
  'the organiser opening their own link is taken into the trip'
);
select results_eq(
  $$ select role::text from public.trip_members
     where user_id = '11111111-1111-1111-1111-111111111111' $$,
  array['organiser'],
  'the organiser opening their own link is still the organiser'
);

-- Expired, revoked and unknown links grant nothing and say nothing ----------
-- Each failure names what went wrong and nothing about the trip: no id, no
-- name, no organiser. frank stays a stranger throughout.

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select throws_ok(
  $$ select public.join_trip(repeat('x', 43)) $$,
  'P0001', 'invitation_expired',
  'an expired link is refused, saying only that it expired'
);
select throws_ok(
  $$ select public.join_trip(repeat('r', 43)) $$,
  'P0001', 'invitation_revoked',
  'a revoked link is refused, saying only that it was revoked'
);
select throws_ok(
  $$ select public.join_trip(repeat('n', 43)) $$,
  'P0001', 'invitation_invalid',
  'an unknown link is refused, saying only that it is not valid'
);
select throws_ok(
  $$ select public.join_trip(null) $$,
  'P0001', 'invitation_invalid',
  'an empty token is refused as not valid'
);
select is_empty(
  $$ select id from public.trips $$,
  'after the refused links, the stranger still reads no trip'
);
-- No token leads anywhere by lookup either: a stranger reads no invitation,
-- so a token cannot be turned into a trip id.
select is_empty(
  $$ select trip_id from public.invitations $$,
  'a stranger cannot look up which trip a token belongs to'
);

reset role;
select is_empty(
  $$ select user_id from public.trip_members
     where user_id = '66666666-6666-6666-6666-666666666666' $$,
  'an expired, revoked or unknown token grants no membership'
);

-- A departed member needs a link issued after they left -----------------------
-- Otherwise a removed member could walk straight back in with the link that
-- let them in the first time.

set local role authenticated;
set local request.jwt.claims to '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}';

select throws_ok(
  $$ select public.join_trip(repeat('v', 43)) $$,
  'P0001', 'invitation_predates_departure',
  'a departed member cannot come back with a link issued before they left'
);
select is_empty(
  $$ select id from public.trips $$,
  'the refused rejoin grants no access'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select results_eq(
  $$ select trip_id, joined from public.join_trip(repeat('f', 43)) $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, true) $$,
  'a departed member comes back with a link issued after they left'
);
select results_eq(
  $$ select left_at is null from public.trip_members
     where user_id = '44444444-4444-4444-4444-444444444444' $$,
  array[true],
  'the returning member is a current member again, on the same row'
);

-- Revoking ---------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ select public.revoke_invitation('a0000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a member who is not the organiser cannot revoke an invitation'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select throws_ok(
  $$ select public.revoke_invitation('a0000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'the organiser of another trip cannot revoke this trip''s invitation'
);

reset role;
select results_eq(
  $$ select revoked_at is null from public.invitations
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  array[true],
  'the refused revocations left the invitation working'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ select public.revoke_invitation('a0000000-0000-0000-0000-000000000001') $$,
  'the organiser revokes an invitation'
);
select lives_ok(
  $$ select public.revoke_invitation('a0000000-0000-0000-0000-000000000001') $$,
  'revoking an already revoked invitation is not an error'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select throws_ok(
  $$ select public.join_trip(repeat('v', 43)) $$,
  'P0001', 'invitation_revoked',
  'a revoked link stops working immediately'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select results_eq(
  $$ select name from public.trips $$,
  array['Tokyo'],
  'revoking a link does not remove the people who already joined with it'
);

-- An unauthenticated caller can do none of it ---------------------------------

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select public.join_trip(repeat('f', 43)) $$,
  '42501', null,
  'an unauthenticated caller cannot open an invitation'
);
select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'an unauthenticated caller cannot issue an invitation'
);
select throws_ok(
  $$ select public.revoke_invitation('a0000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'an unauthenticated caller cannot revoke an invitation'
);
select throws_ok(
  $$ select * from public.invitations $$,
  '42501', null,
  'an unauthenticated caller cannot read invitations'
);

reset role;

select * from finish();

rollback;
