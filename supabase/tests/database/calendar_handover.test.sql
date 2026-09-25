-- Calendar handover and recovery (#13): a calendar whose authorisation lapsed,
-- or whose holder left, says so to every member; any member takes it over
-- onto a new calendar of their own, and the trip's decided meals are queued
-- to be written there; the new holder is told whose old calendar to have
-- deleted. Who may see and change all this.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A, who connected its calendar
--   bob    member of trip A
--   frank  member of trip A
--   carol  organiser of trip B, which has its own calendar
--   erin   signed in, in no trip
--
-- Meals of trip A: dinner (decided, written), lunch (decided, waiting),
-- breakfast (decision cleared, its event not yet deleted).
begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '2 days');

insert into public.meals (id, trip_id, date, slot) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch'),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'breakfast'),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-21', 'lunch');

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri'),
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Ichiran'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tosokchon');

-- Trip A's calendar was connected before #13, so its events carry bare meal ids.
insert into public.calendar_grants (trip_id, holder_id, refresh_token, calendar_id, event_suffix) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'alice-refresh-token', 'tokyo-alice', '');
insert into public.calendar_grants (trip_id, holder_id, refresh_token, calendar_id) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'carol-refresh-token', 'seoul-carol');

insert into public.decisions (meal_id, proposal_id, decided_by) values
  ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333');


-- Dinner is on alice's calendar; lunch waits; breakfast's event awaits deleting.
update public.calendar_events
set status = 'synced', event_id = 'a0000000000000000000000000000001', calendar_id = 'tokyo-alice', revision = 1
where meal_id = 'a0000000-0000-0000-0000-000000000001';
insert into public.calendar_events (meal_id, trip_id, status, event_id, calendar_id)
values ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pending',
        'a0000000000000000000000000000003', 'tokyo-alice');

create function pg_temp.event(meal uuid) returns text language sql as $$
  select coalesce(
    (select e.status || ' r' || e.revision || ' ' || coalesce(e.calendar_id, '-') || ' ' || coalesce(e.event_id, '-')
     from public.calendar_events e where e.meal_id = meal),
    'absent')
$$;

-- Each new calendar's events get ids of their own --------------------------------------

select matches(
  (select event_suffix from public.calendar_grants where trip_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  '^[0-9a-v]{6,}$',
  'a newly connected calendar gets an event id suffix Google accepts'
);

-- A member sees whether the calendar still works --------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select holder_id, lapsed_at, lapse_reason, previous_holder_id from public.calendar_grants $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, null::timestamptz, null::text, null::uuid) $$,
  'a member sees whether their trip''s calendar works, and no other trip''s'
);
select throws_ok(
  $$ select refresh_token from public.calendar_grants $$,
  '42501', null,
  'still without the refresh token'
);
select throws_ok(
  $$ select event_suffix, refresh_token from public.calendar_grants $$,
  '42501', null,
  'in any combination of columns'
);

-- Only the calendar Edge Function records a lapse or a handover -------------------------

select throws_ok(
  $$ select public.lapse_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice', 'alice-refresh-token', 'revoked') $$,
  '42501', null,
  'a member cannot mark the calendar lapsed'
);
select throws_ok(
  $$ select public.hand_over_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice',
       '22222222-2222-2222-2222-222222222222', 'bob-token', 'tokyo-bob') $$,
  '42501', null,
  'a member cannot hand the calendar to themselves without Google'
);
select throws_ok(
  $$ update public.calendar_grants set holder_id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null,
  'nor by writing the grant'
);
select throws_ok(
  $$ update public.calendar_grants set lapsed_at = null, lapse_reason = null $$,
  '42501', null,
  'a member cannot hide a lapse'
);

-- A stranger neither reads nor changes a trip's grant ----------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ select trip_id from public.calendar_grants $$,
  'a stranger reads no trip''s grant'
);
select throws_ok(
  $$ update public.calendar_grants set calendar_id = 'mine' $$,
  '42501', null,
  'a stranger cannot change a grant'
);
select throws_ok(
  $$ delete from public.calendar_grants $$,
  '42501', null,
  'nor remove one'
);
select throws_ok(
  $$ select public.forget_previous_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'nor touch its handover note'
);

-- A lapse, as the Edge Function records it on meeting invalid_grant -----------------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select is(
  public.lapse_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'some-other-calendar', 'alice-refresh-token', 'revoked'),
  false,
  'a lapse met on a calendar the trip no longer uses is not recorded'
);
select throws_ok(
  $$ select public.lapse_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice', 'alice-refresh-token', 'bored') $$,
  '23514', null,
  'a lapse has one of the known reasons'
);
select is(
  public.lapse_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice', 'an-older-token', 'revoked'),
  false,
  'a lapse met with a token the holder has since replaced is not recorded'
);
select is(
  public.lapse_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice', 'alice-refresh-token', 'revoked'),
  true,
  'a lapse on the trip''s calendar is recorded'
);
select results_eq(
  $$ select lapse_reason, lapsed_at is not null, refresh_token is null
     from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('revoked', true, true) $$,
  'the grant says why it lapsed, and the dead token is dropped'
);
select is(
  (select lapse_reason from public.calendar_grants where trip_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  null,
  'another trip''s calendar is untouched'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select results_eq(
  $$ select lapse_reason from public.calendar_grants $$,
  $$ values ('revoked') $$,
  'every member sees the calendar has stopped working'
);

-- Any member takes over ----------------------------------------------------------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select is(
  public.hand_over_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'not-the-current-one',
    '22222222-2222-2222-2222-222222222222', 'bob-token', 'tokyo-bob'),
  false,
  'a takeover that raced another one changes nothing'
);
select is(
  (select holder_id from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'and alice still holds it'
);

select is(
  public.hand_over_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice',
    '22222222-2222-2222-2222-222222222222', 'bob-token', 'tokyo-bob'),
  true,
  'bob takes over onto his own new calendar'
);
select results_eq(
  $$ select holder_id, refresh_token, calendar_id, lapsed_at, lapse_reason,
            previous_holder_id, previous_calendar_id
     from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, 'bob-token', 'tokyo-bob',
             null::timestamptz, null::text,
             '11111111-1111-1111-1111-111111111111'::uuid, 'tokyo-alice') $$,
  'the grant is bob''s, working, and remembers whose calendar it replaced'
);
select matches(
  (select event_suffix from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '^[0-9a-v]{6,}$',
  'the new calendar''s events get ids of their own, never those on the old calendar'
);

-- Every decided meal is queued for the new calendar --------------------------------------

select is(pg_temp.event('a0000000-0000-0000-0000-000000000001'), 'pending r2 - -',
  'a meal written to the old calendar waits to be written to the new one');
select is(pg_temp.event('a0000000-0000-0000-0000-000000000002'), 'pending r1 - -',
  'a meal still waiting keeps waiting, now for the new calendar');
select is(pg_temp.event('a0000000-0000-0000-0000-000000000003'), 'absent',
  'a cleared meal''s event was on the old calendar only: nothing to delete on the new one');
select is(pg_temp.event('b0000000-0000-0000-0000-000000000001'), 'pending r1 - -',
  'another trip''s queue is untouched');
select results_eq(
  $$ select meal_id from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') order by meal_id $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid), ('a0000000-0000-0000-0000-000000000002'::uuid) $$,
  'the next pass writes every decided meal to the new calendar'
);
select public.finish_calendar_event('a0000000-0000-0000-0000-000000000001', 2, 'a00000000000000000000000000000010bob', 'tokyo-bob', null);

-- Whom the events invite now ----------------------------------------------------------

select results_eq(
  $$ select * from public.calendar_attendees('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') order by 1 $$,
  $$ values ('alice@example.com'), ('frank@example.com') $$,
  'the previous holder is invited like anyone, and the new holder is not'
);

-- The note about the old calendar --------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select results_eq(
  $$ select holder_id, previous_holder_id, previous_calendar_id from public.calendar_grants $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'tokyo-alice') $$,
  'every member sees who holds the calendar now and whose it replaced'
);
select throws_ok(
  $$ select public.forget_previous_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'a member who holds neither calendar cannot dismiss the note'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ select public.forget_previous_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'the previous holder says their old calendar is gone'
);
select results_eq(
  $$ select holder_id, previous_holder_id, previous_calendar_id from public.calendar_grants $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, null::uuid, null::text) $$,
  'and the note is gone, the calendar still bob''s'
);

-- The holder leaving is handled, not left dangling ------------------------------------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select is(pg_temp.event('a0000000-0000-0000-0000-000000000001'), 'synced r2 tokyo-bob a00000000000000000000000000000010bob',
  'dinner is on bob''s calendar');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select lives_ok($$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'frank, not the holder, leaves');

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select results_eq(
  $$ select lapse_reason, refresh_token from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values (null::text, 'bob-token') $$,
  'someone other than the holder leaving leaves the calendar working'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select lives_ok($$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'bob, the holder, leaves');

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select results_eq(
  $$ select holder_id, lapse_reason, refresh_token is null
     from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, 'holder_left', true) $$,
  'the calendar is marked as its holder having left, and their token is dropped'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ select holder_id, lapse_reason from public.calendar_grants $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, 'holder_left') $$,
  'the members left see who held it and that it needs taking over'
);

-- Removing the holder does the same ----------------------------------------------------------

-- On trip B: erin joins and holds its calendar, then carol removes her.
reset role;
insert into public.trip_members (trip_id, user_id, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'member');
update public.calendar_grants set holder_id = '55555555-5555-5555-5555-555555555555'
where trip_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';
select lives_ok(
  $$ select public.remove_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555') $$,
  'carol removes erin, who holds trip B''s calendar'
);
select results_eq(
  $$ select lapse_reason from public.calendar_grants $$,
  $$ values ('holder_left') $$,
  'a removed holder''s calendar is marked the same way'
);

-- A lapsed calendar takes a takeover; the new holder's own calendar replaces it ----------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select is(
  public.hand_over_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-bob',
    '11111111-1111-1111-1111-111111111111', 'alice-new-token', 'tokyo-alice-2'),
  true,
  'alice takes over the calendar bob left behind'
);
select results_eq(
  $$ select holder_id, lapse_reason, previous_holder_id, previous_calendar_id
     from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, null::text,
             '22222222-2222-2222-2222-222222222222'::uuid, 'tokyo-bob') $$,
  'she is told bob''s calendar is the one to have deleted'
);

-- A holder whose own calendar was deleted takes over from themselves -----------------------------

select is(
  public.lapse_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice-2', 'alice-new-token', 'calendar_gone'),
  true,
  'the trip calendar was deleted from alice''s account'
);
select is(
  public.hand_over_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice-2',
    '11111111-1111-1111-1111-111111111111', 'alice-token-3', 'tokyo-alice-3'),
  true,
  'alice connects again, onto a new calendar'
);
select results_eq(
  $$ select previous_holder_id, previous_calendar_id
     from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values (null::uuid, null::text) $$,
  'with no old calendar left to ask anyone to delete'
);

-- A holder whose calendar was not found from the account they connected now ------------------

select is(
  public.lapse_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice-3', 'alice-token-3', 'revoked'),
  true,
  'alice''s access lapses'
);
select is(
  public.hand_over_calendar('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tokyo-alice-3',
    '11111111-1111-1111-1111-111111111111', 'alice-other-account', 'tokyo-alice-4'),
  true,
  'alice connects again, and her calendar is not found from that account'
);
select results_eq(
  $$ select previous_holder_id, previous_calendar_id
     from public.calendar_grants where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'tokyo-alice-3') $$,
  'she is asked to delete her own old calendar, which may be on her other account'
);

select * from finish();
rollback;
