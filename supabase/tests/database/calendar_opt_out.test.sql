-- Opting out of calendar invitations (#14). An attendee's email is shown to
-- every other attendee, so a member may ask to be left off the trip's events.
-- The setting is theirs alone, per trip; changing it queues the trip's events
-- for rewriting (ADR 0006); nothing but the attendee list follows it.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A, who holds its calendar
--   bob    member of trip A
--   frank  member of trip A and of trip B
--   dave   departed member of trip A
--   carol  organiser of trip B
--
-- Identities are simulated the way PostgREST does it; see trips_rls.test.sql.
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '2 days', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days', null);

insert into public.meals (id, trip_id, date, slot) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner'),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-21', 'lunch');

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Afuri'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tosokchon');

insert into public.decisions (meal_id, proposal_id, decided_by) values
  ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222'),
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333');

insert into public.calendar_grants (trip_id, holder_id, refresh_token, calendar_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'alice-refresh-token', 'tokyo@group.calendar.google.com');

create function pg_temp.queued(meal uuid) returns text language sql as $$
  select coalesce(
    (select e.status || ' r' || e.revision from public.calendar_events e where e.meal_id = meal),
    'absent')
$$;

-- Both trips' events are written.
update public.calendar_events set status = 'synced';

-- Opting out rewrites the trip's events without the member ------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

insert into public.calendar_opt_outs (trip_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

reset role;

select results_eq(
  $$ select * from public.calendar_attendees('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') order by 1 $$,
  $$ values ('frank@example.com') $$,
  'a member who opted out is left off the trip''s attendees'
);
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r2',
  'opting out queues the trip''s existing events to be rewritten');
select is(pg_temp.queued('b0000000-0000-0000-0000-000000000001'), 'synced r1',
  'another trip''s events are left alone');

-- Opting back in puts them back ------------------------------------------------------

update public.calendar_events set status = 'synced';

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

delete from public.calendar_opt_outs where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

reset role;

select results_eq(
  $$ select * from public.calendar_attendees('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') order by 1 $$,
  $$ values ('bob@example.com'), ('frank@example.com') $$,
  'a member who opts back in is an attendee again'
);
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r3',
  'opting back in queues the trip''s events again');

-- Per member per trip ------------------------------------------------------------------
-- frank opts out among the strangers of trip B, and stays on trip A's events.

set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

insert into public.calendar_opt_outs (trip_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

reset role;

select results_eq(
  $$ select * from public.calendar_attendees('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') order by 1 $$,
  $$ values ('carol@example.com') $$,
  'opting out of one trip leaves the member off that trip''s attendees'
);
select results_eq(
  $$ select * from public.calendar_attendees('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') order by 1 $$,
  $$ values ('bob@example.com'), ('frank@example.com') $$,
  'and on every other trip''s'
);

-- A member's setting is theirs alone ------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

insert into public.calendar_opt_outs (trip_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select results_eq(
  $$ select trip_id, user_id from public.calendar_opt_outs $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'a member reads their own setting'
);

-- frank shares trip A with bob.
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select results_eq(
  $$ select trip_id, user_id from public.calendar_opt_outs $$,
  $$ values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '66666666-6666-6666-6666-666666666666'::uuid) $$,
  'a member cannot read another member''s setting, only their own'
);
select throws_ok(
  $$ insert into public.calendar_opt_outs (trip_id, user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'a member cannot opt another member out'
);
delete from public.calendar_opt_outs
where user_id = '22222222-2222-2222-2222-222222222222';

-- The organiser has no say either.
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is_empty(
  $$ select 1 from public.calendar_opt_outs $$,
  'the organiser cannot read a member''s setting'
);
delete from public.calendar_opt_outs
where user_id = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$ insert into public.calendar_opt_outs (trip_id, user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666') $$,
  '42501', null,
  'the organiser cannot opt a member out'
);
select throws_ok(
  $$ update public.calendar_opt_outs set user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'nobody rewrites a setting in place'
);

reset role;

select results_eq(
  $$ select trip_id, user_id from public.calendar_opt_outs order by trip_id $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '22222222-2222-2222-2222-222222222222'::uuid),
            ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '66666666-6666-6666-6666-666666666666'::uuid) $$,
  'a member cannot opt another member back in'
);

-- Only a current member sets it ------------------------------------------------------------

set local role authenticated;

-- dave left trip A; carol was never in it.
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.calendar_opt_outs (trip_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a departed member cannot set it for a trip they left'
);
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.calendar_opt_outs (trip_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a stranger cannot set it for a trip they are not in'
);

-- Opting out changes nothing else -------------------------------------------------------------

set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select meal_id, proposal_id from public.decisions $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'a1000000-0000-0000-0000-000000000001'::uuid) $$,
  'a member who opted out still sees the trip''s decided meals'
);
select results_eq(
  $$ select meal_id, status::text from public.calendar_events $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'pending') $$,
  'and whether they are on the calendar'
);

reset role;

-- Choosing at join ----------------------------------------------------------------------------
-- Joining says the email will be visible, and the choice goes in with the
-- membership: set afterwards, a calendar write in between could already have
-- invited them.

insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com');

insert into public.invitations (trip_id, token, created_by) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', repeat('j', 43), '33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('k', 43), '11111111-1111-1111-1111-111111111111');

-- dave asked to be left off before he left.
insert into public.calendar_opt_outs (trip_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444');

set local role authenticated;

set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select results_eq(
  $$ select joined from public.join_trip(repeat('j', 43), calendar_attendee => false) $$,
  $$ values (true) $$,
  'someone can join a trip declining calendar invitations'
);
select results_eq(
  $$ select trip_id from public.calendar_opt_outs $$,
  $$ values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid) $$,
  'and joins already opted out'
);

set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';
select results_eq(
  $$ select joined from public.join_trip(repeat('k', 43)) $$,
  $$ values (true) $$,
  'someone coming back joins invited, unless they say otherwise'
);
select is_empty(
  $$ select 1 from public.calendar_opt_outs $$,
  'what they choose on coming back replaces what they chose before'
);

-- frank opted out of trip B above, and opens its link again.
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select results_eq(
  $$ select joined from public.join_trip(repeat('j', 43), calendar_attendee => true) $$,
  $$ values (false) $$,
  'a member reopening a link is taken in as before'
);
select results_eq(
  $$ select trip_id from public.calendar_opt_outs $$,
  $$ values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid) $$,
  'and a tick leaves their opt-out as it was'
);

-- bob is invited to trip A's events, and opens its link again, unticking the box.
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
delete from public.calendar_opt_outs where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select results_eq(
  $$ select joined from public.join_trip(repeat('k', 43), calendar_attendee => false) $$,
  $$ values (false) $$,
  'a member reopening a link and unticking the box is taken in as before'
);
select results_eq(
  $$ select trip_id from public.calendar_opt_outs $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) $$,
  'and is opted out, as they asked'
);

reset role;

select results_eq(
  $$ select * from public.calendar_attendees('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') order by 1 $$,
  $$ values ('carol@example.com') $$,
  'whoever joined declining is not invited'
);

select * from finish();
rollback;
