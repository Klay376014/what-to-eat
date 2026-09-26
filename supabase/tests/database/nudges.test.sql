-- Nudges (#16): any current member can nudge the people with no vote on a
-- meal, at most once per meal every six hours, and the database is the judge
-- of that, not the button. A nudge becomes emails through the same outbox as
-- #15, only to current members with no vote, never to the nudger.
--
-- Cast: alice organises Tokyo; bob, carol and frank are members; dave has
-- left; eve is in no trip. Dinner has two proposals: bob voted on one, dave
-- (gone) on the other. Lunch has one proposal, nobody voted. Breakfast has
-- none. Tea is decided.
begin;

create extension if not exists pgtap with schema extensions;

select plan(43);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'eve@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Home', null, null, 'Asia/Taipei');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '5 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '4 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member', now() - interval '3 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '3 days', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555', 'organiser', now() - interval '5 days', null);

update public.profiles set display_name = 'Alice' where id = '11111111-1111-1111-1111-111111111111';

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch', null),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'breakfast', null),
  ('a0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'other', 'Tea');

insert into public.proposals (id, meal_id, proposed_by, place_name, created_at) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Afuri', '2026-10-01 10:00+00'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tsuta', '2026-10-01 11:00+00'),
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Ichiran', '2026-10-01 12:00+00'),
  ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Higashiya', '2026-10-01 12:00+00');

insert into public.votes (proposal_id, voter_id, value) values
  ('a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 1),
  ('a1000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', -1);

insert into public.decisions (meal_id, proposal_id, decided_by) values
  ('a0000000-0000-0000-0000-000000000004', 'a4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

-- A member nudges -----------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  public.nudge_meal('a0000000-0000-0000-0000-000000000001'), now(),
  'a member nudges a meal, and is told when it was nudged');

reset role;
select results_eq(
  $$ select meal_id, trip_id, nudged_by, processed_at from public.meal_nudges $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
             '11111111-1111-1111-1111-111111111111'::uuid, null::timestamptz) $$,
  'the nudge is recorded against the meal and its trip, by the member, waiting to be emailed');

-- The cooldown ---------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'nudge_cooldown',
  'a second nudge on the same meal within six hours is refused, whoever asks');
select lives_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000002') $$,
  'the cooldown is per meal: nudging dinner does not block lunch');

reset role;
select is(
  (select count(*)::int from public.meal_nudges), 2,
  'the refused nudge left nothing behind');

create function pg_temp.refusal_detail(meal uuid) returns text language plpgsql as $$
declare
  detail text;
begin
  perform public.nudge_meal(meal);
  return null;
exception when others then
  get stacked diagnostics detail = pg_exception_detail;
  return detail;
end;
$$;
grant execute on function pg_temp.refusal_detail(uuid) to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';
select is(
  pg_temp.refusal_detail('a0000000-0000-0000-0000-000000000001')::timestamptz,
  now() + interval '6 hours',
  'the refusal says when the meal can next be nudged');

-- The boundary: exactly six hours after the last nudge, it can be nudged again.
reset role;
update public.meal_nudges set created_at = now() - interval '6 hours' + interval '1 microsecond'
where meal_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';
select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'nudge_cooldown',
  'a moment short of six hours, it is still refused');

reset role;
update public.meal_nudges set created_at = now() - interval '6 hours'
where meal_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';
select lives_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000001') $$,
  'at exactly six hours, it can be nudged again');

reset role;
select is(
  (select max(created_at) from public.meal_nudges where meal_id = 'a0000000-0000-0000-0000-000000000001'),
  now(), 'and the cooldown starts again from the new nudge');

-- Who may nudge ---------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'someone outside the trip cannot nudge its meals');

set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';
select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'nor can a member who has left');

set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$ select public.nudge_meal(gen_random_uuid()) $$,
  '42501', null, 'a meal that does not exist is refused the same way');

reset role;
set local role anon;
select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'signed out, nobody can nudge');
reset role;

-- What is not nudged ------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000004') $$,
  'P0001', 'meal_decided', 'a decided meal cannot be nudged');
select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'nothing_to_vote_on', 'nor one with nothing proposed to vote on');

reset role;
-- Everyone but alice votes on lunch; dave, gone, never did.
delete from public.meal_nudges where meal_id = 'a0000000-0000-0000-0000-000000000002';
insert into public.votes (proposal_id, voter_id, value) values
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 1),
  ('a2000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', -1),
  ('a2000000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 1);
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'everyone_voted',
  'nor one where everyone else has voted: the nudger and a departed non-voter do not count');
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
select lives_ok(
  $$ select public.nudge_meal('a0000000-0000-0000-0000-000000000002') $$,
  'but bob, who voted, can nudge alice, who has not');
reset role;

-- Reading nudges ----------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';
select results_eq(
  $$ select meal_id, nudged_by, created_at from public.meal_nudges order by meal_id $$,
  $$ values
       ('a0000000-0000-0000-0000-000000000001'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, now()),
       ('a0000000-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, now() - interval '6 hours'),
       ('a0000000-0000-0000-0000-000000000002'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, now()) $$,
  'a member sees when the trip''s meals were nudged, and by whom, to show the cooldown');
select throws_ok(
  $$ select claimed_until from public.meal_nudges $$,
  '42501', null, 'but not how its emails are getting on');
select throws_ok(
  $$ insert into public.meal_nudges (meal_id, trip_id, nudged_by)
     values ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666') $$,
  '42501', null, 'nor write a nudge past the cooldown');
select throws_ok(
  $$ update public.meal_nudges set created_at = now() - interval '1 day' $$,
  '42501', null, 'nor move a nudge back to clear the cooldown');
select throws_ok($$ delete from public.meal_nudges $$,
  '42501', null, 'nor delete one');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select is_empty($$ select meal_id from public.meal_nudges $$,
  'someone outside the trip sees none of its nudges');
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';
select is_empty($$ select meal_id from public.meal_nudges $$,
  'nor does a member who has left');
reset role;
set local role anon;
select throws_ok($$ select meal_id from public.meal_nudges $$, '42501', null,
  'signed out, nudges are closed');
reset role;

-- The notify function's side ----------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok($$ select * from public.claim_nudges() $$, '42501', null,
  'a member cannot claim nudges to email');
select throws_ok($$ select public.record_nudge_emails(1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '[]') $$,
  '42501', null, 'nor record a nudge''s emails');
reset role;

-- Only the new dinner nudge and lunch's are waiting; mark the older dinner one done.
update public.meal_nudges set processed_at = now()
where meal_id = 'a0000000-0000-0000-0000-000000000001' and created_at < now();

select ok(private.email_work_waiting(now()), 'a nudge waiting to be emailed is work for the schedule');

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

create temp table claimed_nudges on commit drop as select * from public.claim_nudges('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select results_eq(
  $$ select meal_id, trip_name, date, slot::text, label, nudged_by, decided from claimed_nudges order by meal_id $$,
  $$ values
       ('a0000000-0000-0000-0000-000000000001'::uuid, 'Tokyo'::text, '2026-10-02'::date, 'dinner'::text, null::text,
        '33333333-3333-3333-3333-333333333333'::uuid, false),
       ('a0000000-0000-0000-0000-000000000002'::uuid, 'Tokyo', '2026-10-03', 'lunch', null,
        '22222222-2222-2222-2222-222222222222'::uuid, false) $$,
  'the trip''s waiting nudges are claimed with what their emails need');
select results_eq(
  $$ select p ->> 'placeName', p -> 'voterIds'
     from claimed_nudges c, jsonb_array_elements(c.proposals) p
     where c.meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('Afuri'::text, '["22222222-2222-2222-2222-222222222222"]'::jsonb),
            ('Tsuta', '["44444444-4444-4444-4444-444444444444"]') $$,
  'each with the meal''s proposals and who has voted on them as it stands now');
select is_empty($$ select id from public.claim_nudges() $$,
  'a claimed nudge is not handed out again while the claim lasts');
select is_empty($$ select id from public.claim_nudges('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $$,
  'and another trip has none');

select public.record_nudge_emails(
  (select id from claimed_nudges where meal_id = 'a0000000-0000-0000-0000-000000000001'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  $$[
    {"dedupe_key": "nudge:x:alice", "recipient_id": "11111111-1111-1111-1111-111111111111", "subject": "Tokyo: your vote on Dinner", "text": "t", "html": "h"},
    {"dedupe_key": "nudge:x:dave", "recipient_id": "44444444-4444-4444-4444-444444444444", "subject": "Tokyo: your vote on Dinner", "text": "t", "html": "h"},
    {"dedupe_key": "nudge:x:eve", "recipient_id": "55555555-5555-5555-5555-555555555555", "subject": "Tokyo: your vote on Dinner", "text": "t", "html": "h"}
  ]$$::jsonb);
reset role;

select results_eq(
  $$ select dedupe_key, kind, status::text from public.email_outbox order by dedupe_key $$,
  $$ values ('nudge:x:alice'::text, 'nudge'::text, 'pending'::text) $$,
  'a nudge''s emails go in the outbox as nudges, never to someone who left or a stranger');
select results_eq(
  $$ select processed_at is not null, claimed_until is null from public.meal_nudges
     where meal_id = 'a0000000-0000-0000-0000-000000000001' and created_at = now() $$,
  $$ values (true, true) $$,
  'and the nudge is done, its claim released');

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select public.record_nudge_emails(
  (select id from claimed_nudges where meal_id = 'a0000000-0000-0000-0000-000000000001'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  $$[{"dedupe_key": "nudge:x:alice", "recipient_id": "11111111-1111-1111-1111-111111111111", "subject": "Changed", "text": "t", "html": "h"}]$$::jsonb);
reset role;
select results_eq(
  $$ select count(*)::int, min(subject) from public.email_outbox where dedupe_key = 'nudge:x:alice' $$,
  $$ values (1, 'Tokyo: your vote on Dinner'::text) $$,
  'recording the same emails again adds nothing and changes nothing');

-- A nudge whose pass failed is taken again once its claim runs out.
update public.meal_nudges set claimed_until = now() - interval '1 second'
where meal_id = 'a0000000-0000-0000-0000-000000000002';
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select results_eq(
  $$ select meal_id from public.claim_nudges() $$,
  $$ values ('a0000000-0000-0000-0000-000000000002'::uuid) $$,
  'a nudge whose claim ran out is claimed again');
reset role;

-- Cleanup --------------------------------------------------------------------------------------------

update public.meal_nudges set created_at = now() - interval '40 days', processed_at = now() - interval '40 days'
where meal_id = 'a0000000-0000-0000-0000-000000000001';
update public.meal_nudges set created_at = now() - interval '40 days', processed_at = null, claimed_until = null
where meal_id = 'a0000000-0000-0000-0000-000000000002';
select is(
  (private.prune_email_records() ->> 'nudges')::int, 2,
  'the daily cleanup deletes nudges emailed more than 30 days ago');
select results_eq(
  $$ select meal_id from public.meal_nudges $$,
  $$ values ('a0000000-0000-0000-0000-000000000002'::uuid) $$,
  'but never one still waiting to be emailed');

-- Grants and the outbox kinds -------------------------------------------------------------------------

select ok(
  not has_function_privilege('service_role', 'public.nudge_meal(uuid)', 'execute'),
  'the Edge Function cannot nudge on anyone''s behalf');
select ok(
  has_function_privilege('service_role', 'public.claim_nudges(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.record_nudge_emails(bigint, uuid, jsonb)', 'execute'),
  'it can claim nudges and record their emails');
select throws_ok(
  $$ insert into public.email_outbox (dedupe_key, kind, trip_id, recipient_id, subject, body_text, body_html)
     values ('x:1', 'spam', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 's', 't', 'h') $$,
  '23514', null, 'the outbox still refuses kinds it does not know');

-- Deleting ---------------------------------------------------------------------------------------------

select lives_ok(
  $$ delete from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a trip with nudges can still be deleted');
select is((select count(*)::int from public.meal_nudges), 0, 'its nudges go with it');

select * from finish();
rollback;
