-- The calendar queue (#12): a decision is a database fact first, and every
-- change a meal's event must follow queues the meal for the calendar Edge
-- Function, whether or not a calendar is connected yet. The function claims
-- queued meals, writes them, and records the outcome; a change that lands
-- while it writes keeps the meal queued.
--
-- Cast: alice organises trip A, bob and frank are members, gina joins later,
-- dave has left. Meals: dinner (decided below), lunch (never decided).
begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'gina@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days', null);

insert into public.meals (id, trip_id, date, slot) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch');

insert into public.proposals (id, meal_id, proposed_by, place_name, note, lat, lng) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Afuri', 'Yuzu ramen', 35.66, 139.70),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tsuta', null, null, null),
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Ichiran', null, null, null);

create function pg_temp.queued(meal uuid) returns text language sql as $$
  select coalesce(
    (select e.status || ' r' || e.revision from public.calendar_events e where e.meal_id = meal),
    'absent')
$$;

-- Deciding queues the meal, calendar or no calendar ------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'absent',
  'an undecided meal has nothing queued');

insert into public.decisions (meal_id, proposal_id)
values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001');

select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r1',
  'deciding a meal queues it before any calendar is connected');
select is(
  (select trip_id from public.calendar_events where meal_id = 'a0000000-0000-0000-0000-000000000001'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the queued meal is filed under its trip');

-- Setting a meal's own time ------------------------------------------------------------

select lives_ok(
  $$ update public.meals set start_time = '20:30' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  'a member sets a meal''s own start time');
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r2',
  'a new time queues the decided meal again');
select lives_ok(
  $$ update public.meals set start_time = '13:15' where id = 'a0000000-0000-0000-0000-000000000002' $$,
  'an undecided meal takes a time too');
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000002'), 'absent',
  'but has no event to queue');
select throws_ok(
  $$ update public.meals set start_time = '20:30:15' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a meal''s time is in whole minutes');
select lives_ok(
  $$ update public.meals set start_time = null where id = 'a0000000-0000-0000-0000-000000000002' $$,
  'clearing the time goes back to the slot''s default');

-- The worker claims the queue ------------------------------------------------------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select results_eq(
  $$ select meal_id, revision, event_id, date, slot::text, label, start_time,
            place_name, note, lat, lng
     from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 2::bigint, null::text,
             '2026-10-02'::date, 'dinner', null::text, '20:30'::time,
             'Afuri', 'Yuzu ramen', 35.66::double precision, 139.70::double precision) $$,
  'claiming hands over each queued meal with what its event needs');
select is_empty(
  $$ select meal_id from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'a claimed meal is not handed out twice while the claim lasts');

select public.finish_calendar_event(
  'a0000000-0000-0000-0000-000000000001', 2,
  'a0000000000000000000000000000001', 'tokyo@group.calendar.google.com', null);

select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'synced r2',
  'a written meal is synced');
select results_eq(
  $$ select event_id, calendar_id, synced_at is not null, error from public.calendar_events
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('a0000000000000000000000000000001', 'tokyo@group.calendar.google.com', true, null::text) $$,
  'with its event and calendar recorded');
select is_empty(
  $$ select meal_id from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'a synced meal is not claimed');

-- Changes the event must follow queue it again -----------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000002'
where meal_id = 'a0000000-0000-0000-0000-000000000001';
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r3',
  'changing the decision queues the meal again');
select is(
  (select event_id from public.calendar_events where meal_id = 'a0000000-0000-0000-0000-000000000001'),
  'a0000000000000000000000000000001',
  'keeping its event, so the change updates it rather than making another');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

update public.proposals set note = 'Book ahead' where id = 'a1000000-0000-0000-0000-000000000002';
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r4',
  'editing the decided restaurant''s note queues the meal again');
update public.proposals set note = 'Cash only' where id = 'a2000000-0000-0000-0000-000000000001';
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000002'), 'absent',
  'editing an undecided meal''s proposal queues nothing');

update public.trips set timezone = 'Asia/Seoul' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r5',
  'changing the trip''s timezone queues its decided meals, whose times move');
update public.trips set name = 'Tokyo and Seoul' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r5',
  'renaming the trip does not');

reset role;
insert into public.trip_members (trip_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777');
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r6',
  'someone joining queues the decided meals, to invite them');
update public.trip_members set left_at = now()
where user_id = '77777777-7777-7777-7777-777777777777';
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r7',
  'and so does someone leaving');

-- A change while the worker writes keeps the meal queued ----------------------------------

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select is(
  (select revision from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  7::bigint, 'the worker claims the meal as it stands');

reset role;
update public.meals set start_time = '21:00' where id = 'a0000000-0000-0000-0000-000000000001';
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select public.finish_calendar_event(
  'a0000000-0000-0000-0000-000000000001', 7,
  'a0000000000000000000000000000001', 'tokyo@group.calendar.google.com', null);
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r8',
  'a meal that changed while it was written stays queued');
select is(
  (select revision from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  8::bigint, 'and can be claimed again at once, for the newer change');

-- A failed write stays visible and is retried --------------------------------------------

select public.finish_calendar_event(
  'a0000000-0000-0000-0000-000000000001', 8, null, null, 'Google Calendar answered 500');
select results_eq(
  $$ select status::text, error from public.calendar_events
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('failed', 'Google Calendar answered 500') $$,
  'a failed write leaves the meal failed, with why');
select is(
  (select event_id from public.calendar_events where meal_id = 'a0000000-0000-0000-0000-000000000001'),
  'a0000000000000000000000000000001',
  'and forgets none of what an earlier write recorded');
select is(
  (select meal_id from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a failed meal is claimed again on the next pass');
select public.finish_calendar_event(
  'a0000000-0000-0000-0000-000000000001', 8, null, null, 'Google Calendar answered 500');

-- Who is invited --------------------------------------------------------------------
-- The holder is left out: the event is already on their calendar, and an
-- invitation would put a second copy on their primary one.

reset role;
insert into public.calendar_grants (trip_id, holder_id, refresh_token)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 't');
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select results_eq(
  $$ select * from public.calendar_attendees('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') order by 1 $$,
  $$ values ('bob@example.com'), ('frank@example.com') $$,
  'the attendees are the trip''s current members but the holder, not those who left');

-- Clearing a decision --------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

delete from public.decisions where meal_id = 'a0000000-0000-0000-0000-000000000001';
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'pending r9',
  'clearing a decision queues its event for deletion');

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select results_eq(
  $$ select event_id, place_name
     from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  $$ values ('a0000000000000000000000000000001', null::text) $$,
  'the worker is handed the event to delete, with no restaurant');
select public.finish_calendar_event('a0000000-0000-0000-0000-000000000001', 9, null, null, null);
select is(pg_temp.queued('a0000000-0000-0000-0000-000000000001'), 'absent',
  'once the event is deleted the meal leaves the queue');

-- Deleting the trip ----------------------------------------------------------------------

reset role;
insert into public.decisions (meal_id, proposal_id, decided_by)
values ('a0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ delete from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'the organiser still deletes a trip with a calendar and queued meals');
reset role;
select is_empty($$ select 1 from public.calendar_events $$, 'its queue goes with it');
select is_empty($$ select 1 from public.calendar_grants $$, 'and its calendar connection');

select * from finish();
rollback;
