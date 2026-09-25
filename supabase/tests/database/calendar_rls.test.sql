-- Who can see and touch a trip's calendar connection and its events (#12).
-- Members see whether the trip has a calendar, whose it is and each meal's
-- sync status; nobody but service_role (the calendar Edge Function) writes
-- them, and no client ever reads a refresh token.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A, who connected its calendar
--   bob    member of trip A
--   dave   departed member of trip A
--   carol  organiser of trip B, which has its own calendar
--   erin   signed in, in no trip
--
-- Identities are simulated the way PostgREST does it; see trips_rls.test.sql.
begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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

insert into public.meals (id, trip_id, date, slot) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner'),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-21', 'lunch');

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tosokchon');

-- Deciding queues each meal for its calendar (calendar_queue.test.sql).
insert into public.decisions (meal_id, proposal_id, decided_by) values
  ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333');

insert into public.calendar_grants (trip_id, holder_id, refresh_token, calendar_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'alice-refresh-token', 'tokyo@group.calendar.google.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'carol-refresh-token', 'seoul@group.calendar.google.com');

-- A member sees the trip's connection and sync status -------------------------------
-- The positive controls: without them, every denial below would also pass
-- against a policy that refuses everyone.

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select trip_id, holder_id, calendar_id from public.calendar_grants $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
             '11111111-1111-1111-1111-111111111111'::uuid,
             'tokyo@group.calendar.google.com') $$,
  'a member sees who holds their trip''s calendar, and no other trip''s'
);
select results_eq(
  $$ select meal_id, status::text from public.calendar_events $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'pending') $$,
  'a member sees their trip''s meals'' calendar status, and no other trip''s'
);

-- Nobody reads a refresh token -------------------------------------------------------

select throws_ok(
  $$ select refresh_token from public.calendar_grants $$,
  '42501', null,
  'a member cannot read the refresh token'
);
select throws_ok(
  $$ select * from public.calendar_grants $$,
  '42501', null,
  'nor through select *'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ select refresh_token from public.calendar_grants $$,
  '42501', null,
  'the holder cannot read back their own refresh token either'
);

-- Only service_role writes ----------------------------------------------------------

select throws_ok(
  $$ insert into public.calendar_grants (trip_id, holder_id, refresh_token)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'x') $$,
  '42501', null,
  'a member cannot write a grant'
);
select throws_ok(
  $$ update public.calendar_grants set calendar_id = 'elsewhere' $$,
  '42501', null,
  'a member cannot repoint the trip''s calendar'
);
select throws_ok(
  $$ delete from public.calendar_grants $$,
  '42501', null,
  'a member cannot remove the connection'
);
select throws_ok(
  $$ update public.calendar_events set status = 'synced' $$,
  '42501', null,
  'a member cannot mark a meal as synced'
);
select throws_ok(
  $$ delete from public.calendar_events $$,
  '42501', null,
  'a member cannot drop a meal from the queue'
);
select throws_ok(
  $$ select * from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a member cannot claim the queue'
);
select throws_ok(
  $$ select public.finish_calendar_event('a0000000-0000-0000-0000-000000000001', 1, 'e', 'c', null) $$,
  '42501', null,
  'a member cannot record a write'
);
select throws_ok(
  $$ select * from public.calendar_attendees('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a member cannot list the attendees'' email addresses'
);

-- A departed member and a stranger see nothing --------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ select trip_id from public.calendar_grants $$,
  'a departed member no longer sees the trip''s calendar'
);
select is_empty(
  $$ select meal_id from public.calendar_events $$,
  'nor its meals'' sync status'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ select trip_id from public.calendar_grants $$,
  'a stranger sees no trip''s calendar'
);
select is_empty(
  $$ select meal_id from public.calendar_events $$,
  'nor any meal''s sync status'
);

reset role;
set local role anon;

select throws_ok(
  $$ select trip_id from public.calendar_grants $$,
  '42501', null,
  'anon reads nothing'
);

-- service_role, the calendar Edge Function, reads and writes everything -------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select results_eq(
  $$ select refresh_token from public.calendar_grants order by trip_id $$,
  $$ values ('alice-refresh-token'), ('carol-refresh-token') $$,
  'service_role reads the refresh tokens'
);
select lives_ok(
  $$ update public.calendar_grants set calendar_id = 'new@group.calendar.google.com'
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'service_role records the trip''s calendar'
);
select lives_ok(
  $$ select * from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'service_role claims the queue'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'service_role still decides nothing for anyone'
);

select * from finish();
rollback;
