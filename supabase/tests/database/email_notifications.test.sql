-- Email (#15): decisions leave notices, digests are recorded once per trip
-- per day, and the outbox sends each email once, only ever to current
-- members. No client can read any of it or call the notify function's side.
--
-- Cast: alice organises Tokyo, bob and frank are members, carol opted out of
-- calendar invitations, dave has left. eve is in no trip.
begin;

create extension if not exists pgtap with schema extensions;

select plan(51);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'eve@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com');

update public.profiles set display_name = 'Alice' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Bob' where id = '22222222-2222-2222-2222-222222222222';

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Home', null, null, 'Asia/Taipei');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '5 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '4 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member', now() - interval '3 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '3 days', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'organiser', now() - interval '5 days', null);

insert into public.calendar_opt_outs (trip_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333');

insert into public.meals (id, trip_id, date, slot) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch');

insert into public.proposals (id, meal_id, proposed_by, place_name, created_at) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Afuri', '2026-10-01 10:00+00'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tsuta', '2026-10-01 11:00+00'),
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Ichiran', '2026-10-01 12:00+00');

insert into public.votes (proposal_id, voter_id, value) values
  ('a1000000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 1),
  ('a1000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', -1);

create function pg_temp.notices() returns table (
  prev text, now_place text, actor uuid
) language sql as $$
  select n.previous_place_name, n.place_name, n.actor_id
  from public.decision_notices n
  where n.meal_id = 'a0000000-0000-0000-0000-000000000001'
  order by n.id
$$;

-- Deciding, changing and clearing leave notices -----------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

insert into public.decisions (meal_id, proposal_id)
values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001');

reset role;
select results_eq(
  $$ select * from pg_temp.notices() $$,
  $$ values (null::text, 'Afuri'::text, '66666666-6666-6666-6666-666666666666'::uuid) $$,
  'deciding a meal leaves a notice of the restaurant, by the member who decided');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000001'
where meal_id = 'a0000000-0000-0000-0000-000000000001';
reset role;
select is((select count(*)::int from public.decision_notices), 1,
  're-sending the same restaurant tells nobody anything');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000002'
where meal_id = 'a0000000-0000-0000-0000-000000000001';
reset role;
select results_eq(
  $$ select * from pg_temp.notices() offset 1 $$,
  $$ values ('Afuri'::text, 'Tsuta'::text, '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'changing it leaves a notice of before and after, by whoever changed it');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
delete from public.decisions where meal_id = 'a0000000-0000-0000-0000-000000000001';
reset role;
select results_eq(
  $$ select * from pg_temp.notices() offset 2 $$,
  $$ values ('Tsuta'::text, null::text, '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'clearing it leaves a notice too, by whoever cleared it');
select is(
  (select trip_id from public.decision_notices order by id limit 1),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'each notice is filed under the meal''s trip');

-- No client reads or writes any of it --------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok($$ select * from public.decision_notices $$, '42501', null,
  'a member cannot read the trip''s decision notices');
select throws_ok($$ select * from public.email_outbox $$, '42501', null,
  'nor the outbox, which holds what others were told');
select throws_ok($$ select * from public.digest_runs $$, '42501', null,
  'nor the digest runs');
select throws_ok(
  $$ insert into public.email_outbox (dedupe_key, kind, trip_id, recipient_id, subject, body_text, body_html)
     values ('x', 'digest', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 's', 't', 'h') $$,
  '42501', null,
  'nor put an email in the outbox');
select throws_ok($$ select * from public.trip_contacts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501', null, 'nor list the trip''s email addresses');
select throws_ok($$ select * from public.claim_emails() $$, '42501', null,
  'nor claim emails to send');
select throws_ok($$ select * from public.claim_decision_notices() $$, '42501', null,
  'nor claim decision notices');
select throws_ok(
  $$ select public.record_digest('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', now(), '[]') $$,
  '42501', null, 'nor record a digest');
select throws_ok(
  $$ select public.finish_email(gen_random_uuid(), null, null, false) $$,
  '42501', null, 'nor mark an email sent');
select throws_ok($$ select * from public.digest_trips() $$, '42501', null,
  'nor list every trip for digests');
select throws_ok(
  $$ select * from public.digest_meals('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-01') $$,
  '42501', null, 'nor read a trip''s meals through the digest');

reset role;
set local role anon;
select throws_ok($$ select * from public.email_outbox $$, '42501', null,
  'signed out, the outbox is closed too');
select throws_ok($$ select * from public.claim_emails() $$, '42501', null,
  'and so is claiming');

-- service_role: who is emailed ------------------------------------------------------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select throws_ok($$ select * from public.email_outbox $$, '42501', null,
  'even the Edge Function goes through the functions, not the tables');

select results_eq(
  $$ select user_id, email, name, left_at is not null
     from public.trip_contacts('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  $$ values
       ('11111111-1111-1111-1111-111111111111'::uuid, 'alice@example.com'::text, 'Alice'::text, false),
       ('22222222-2222-2222-2222-222222222222'::uuid, 'bob@example.com'::text, 'Bob'::text, false),
       ('33333333-3333-3333-3333-333333333333'::uuid, 'carol@example.com'::text, null::text, false),
       ('44444444-4444-4444-4444-444444444444'::uuid, 'dave@example.com'::text, null::text, true),
       ('66666666-6666-6666-6666-666666666666'::uuid, 'frank@example.com'::text, null::text, false) $$,
  'contacts are every member with their address; carol opted out of the calendar, not of email; dave is marked as gone');

-- Decision notices: claimed, composed once ----------------------------------------------------

create temp table claimed_notices on commit drop as
  select * from public.claim_decision_notices('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select results_eq(
  $$ select trip_name, date, slot::text, previous_place_name, place_name from claimed_notices order by id $$,
  $$ values ('Tokyo'::text, '2026-10-02'::date, 'dinner'::text, null::text, 'Afuri'::text),
            ('Tokyo', '2026-10-02', 'dinner', 'Afuri', 'Tsuta'),
            ('Tokyo', '2026-10-02', 'dinner', 'Tsuta', null) $$,
  'the trip''s waiting notices are claimed together, with what their emails need');
select is(
  (select count(*)::int from public.claim_decision_notices()),
  0, 'and are not handed out again while the claim lasts');

select public.record_decision_emails(
  array(select id from claimed_notices),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  $$[
    {"dedupe_key": "decision:3:bob", "recipient_id": "22222222-2222-2222-2222-222222222222", "subject": "Tokyo: Dinner is undecided again", "text": "t", "html": "h"},
    {"dedupe_key": "decision:3:carol", "recipient_id": "33333333-3333-3333-3333-333333333333", "subject": "Tokyo: Dinner is undecided again", "text": "t", "html": "h"},
    {"dedupe_key": "decision:3:dave", "recipient_id": "44444444-4444-4444-4444-444444444444", "subject": "Tokyo: Dinner is undecided again", "text": "t", "html": "h"},
    {"dedupe_key": "decision:3:eve", "recipient_id": "55555555-5555-5555-5555-555555555555", "subject": "Tokyo: Dinner is undecided again", "text": "t", "html": "h"}
  ]$$::jsonb);

reset role;
select results_eq(
  $$ select dedupe_key, kind, status::text from public.email_outbox order by dedupe_key $$,
  $$ values ('decision:3:bob'::text, 'decision'::text, 'pending'::text),
            ('decision:3:carol', 'decision', 'pending') $$,
  'the emails go in the outbox, but never to a member who left or a stranger');
select is(
  (select count(*)::int from public.decision_notices where processed_at is null), 0,
  'and the notices they came from are done');
select is(
  (select count(*)::int from public.decision_notices where claimed_until is not null), 0,
  'with their claim released');

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select public.record_decision_emails(
  array[3::bigint], 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  $$[{"dedupe_key": "decision:3:bob", "recipient_id": "22222222-2222-2222-2222-222222222222", "subject": "Changed wording", "text": "t", "html": "h"}]$$::jsonb);
reset role;
select results_eq(
  $$ select count(*)::int, min(subject) from public.email_outbox where dedupe_key = 'decision:3:bob' $$,
  $$ values (1, 'Tokyo: Dinner is undecided again'::text) $$,
  'recording the same emails again adds nothing and changes nothing');

-- Sending: claim, lease, finish ------------------------------------------------------------

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

create temp table claimed on commit drop as
  select * from public.claim_emails('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1);
select results_eq(
  $$ select dedupe_key, to_email from claimed $$,
  $$ values ('decision:3:bob'::text, 'bob@example.com'::text) $$,
  'claiming hands over the oldest due emails, with the address to send to, up to the limit');
select is(
  (select count(*)::int from public.claim_emails(null, 10)), 1,
  'a claimed email is not handed out twice while the claim lasts');

select public.finish_email((select id from claimed), 'resend-1', null, false);
reset role;
select results_eq(
  $$ select status::text, provider_id, sent_at is not null, claimed_until is null
     from public.email_outbox where dedupe_key = 'decision:3:bob' $$,
  $$ values ('sent'::text, 'resend-1'::text, true, true) $$,
  'a sent email is recorded as sent, with the provider''s id');

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select public.finish_email((select id from claimed), null, 'Resend 500: late answer', true);
reset role;
select is(
  (select status::text from public.email_outbox where dedupe_key = 'decision:3:bob'), 'sent',
  'a late failure cannot undo a send');

-- carol's email: fails and is retried later
update public.email_outbox set claimed_until = null where dedupe_key = 'decision:3:carol';
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select public.finish_email(
  (select id from public.claim_emails(null, 10)), null, 'Resend 503: unavailable', true);
reset role;
select results_eq(
  $$ select status::text, attempts, last_error, next_attempt_at > now(), claimed_until is null
     from public.email_outbox where dedupe_key = 'decision:3:carol' $$,
  $$ values ('pending'::text, 2, 'Resend 503: unavailable'::text, true, true) $$,
  'a send worth retrying stays pending, due again later (each claim counts as a try)');

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select is_empty($$ select * from public.claim_emails(null, 10) $$,
  'and is not claimed before it is due');
reset role;
update public.email_outbox set attempts = 6, next_attempt_at = now()
where dedupe_key = 'decision:3:carol';
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select public.finish_email(
  (select id from public.claim_emails(null, 10)), null, 'Resend 503: unavailable', true);
reset role;
select is((select status::text from public.email_outbox where dedupe_key = 'decision:3:carol'),
  'failed', 'after its last try it is given up');

-- A refusal is not retried.
insert into public.email_outbox (dedupe_key, kind, trip_id, recipient_id, subject, body_text, body_html)
values ('decision:9:frank', 'decision', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 's', 't', 'h');
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select public.finish_email(
  (select id from public.claim_emails(null, 10)), null, 'Resend 422: invalid', false);
reset role;
select is((select status::text from public.email_outbox where dedupe_key = 'decision:9:frank'),
  'failed', 'a send the provider refused is not tried again');

-- Someone who leaves stops hearing about the trip at once.
insert into public.email_outbox (dedupe_key, kind, trip_id, recipient_id, subject, body_text, body_html)
values ('digest:tokyo:2026-10-03:frank', 'digest', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 's', 't', 'h');
update public.trip_members set left_at = now()
where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '66666666-6666-6666-6666-666666666666';
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select is_empty($$ select * from public.claim_emails(null, 10) $$,
  'an email waiting for someone who has left is not sent');
reset role;
select is((select status::text from public.email_outbox where dedupe_key = 'digest:tokyo:2026-10-03:frank'),
  'cancelled', 'it is cancelled');

-- Digests -------------------------------------------------------------------------------------

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select results_eq(
  $$ select trip_id, name, timezone, end_date, last_date, last_cut_off
     from public.digest_trips() order by name $$,
  $$ values
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Home'::text, 'Asia/Taipei'::text, null::date, null::date, null::timestamptz),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Tokyo'::text, 'Asia/Tokyo'::text, '2026-10-05'::date, null::date, null::timestamptz) $$,
  'every trip is listed, none with a digest yet');

select results_eq(
  $$ select id, slot::text, decided, jsonb_array_length(proposals)
     from public.digest_meals('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02') $$,
  $$ values ('a0000000-0000-0000-0000-000000000001'::uuid, 'dinner'::text, false, 2),
            ('a0000000-0000-0000-0000-000000000002'::uuid, 'lunch'::text, false, 1) $$,
  'a digest reads the trip''s meals from the given day, in order');
select is_empty(
  $$ select id from public.digest_meals('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04') $$,
  'and none before it');
select results_eq(
  $$ select p ->> 'placeName', p ->> 'proposerName', p -> 'voterIds'
     from public.digest_meals('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02') m,
          jsonb_array_elements(m.proposals) p
     where m.id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('Afuri'::text, 'Bob'::text,
             '["66666666-6666-6666-6666-666666666666", "44444444-4444-4444-4444-444444444444"]'::jsonb),
            ('Tsuta', 'Alice', '[]') $$,
  'each proposal comes with its proposer''s name and everyone who voted on it, departed voters included');
select is(
  (select (p ->> 'createdAt')::timestamptz
   from public.digest_meals('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02') m,
        jsonb_array_elements(m.proposals) p
   where p ->> 'placeName' = 'Ichiran'),
  '2026-10-01 12:00+00'::timestamptz,
  'and when it was made');

select ok(
  public.record_digest('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-10-03', '2026-10-03 00:00+00',
    $$[{"dedupe_key": "digest:home:2026-10-03:bob", "recipient_id": "22222222-2222-2222-2222-222222222222", "subject": "Home: 1 new proposal", "text": "t", "html": "h"}]$$),
  'the first pass records a trip''s digest for the day');
select ok(
  not public.record_digest('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-10-03', '2026-10-03 00:05+00',
    $$[{"dedupe_key": "digest:home:2026-10-03:bob:again", "recipient_id": "22222222-2222-2222-2222-222222222222", "subject": "Home again", "text": "t", "html": "h"}]$$),
  'a second pass for the same day records nothing');
select ok(
  public.record_digest('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', '2026-10-02 23:00+00', '[]'),
  'a day with nothing new is still recorded');
select results_eq(
  $$ select name, last_date, last_cut_off from public.digest_trips() order by name $$,
  $$ values ('Home'::text, '2026-10-03'::date, '2026-10-03 00:00+00'::timestamptz),
            ('Tokyo'::text, '2026-10-03'::date, '2026-10-02 23:00+00'::timestamptz) $$,
  'and each trip''s last digest is where the next starts');

reset role;
select results_eq(
  $$ select dedupe_key, kind from public.email_outbox where trip_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' $$,
  $$ values ('digest:home:2026-10-03:bob'::text, 'digest'::text) $$,
  'only the first pass''s digest is in the outbox');

-- A meal's notices are emailed in order ----------------------------------------------------------
-- A notice whose pass failed stays held; a later change to the same meal
-- waits for it, and then both are taken together (one email, the net change).

insert into public.decision_notices (meal_id, trip_id, previous_proposal_id, previous_place_name, proposal_id, place_name, claimed_until)
values ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        null, null, 'a2000000-0000-0000-0000-000000000001', 'Ichiran', now() + interval '4 minutes');
insert into public.decision_notices (meal_id, trip_id, previous_proposal_id, previous_place_name, proposal_id, place_name)
values ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'a2000000-0000-0000-0000-000000000001', 'Ichiran', null, null);

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select is_empty(
  $$ select id from public.claim_decision_notices()
     where meal_id = 'a0000000-0000-0000-0000-000000000002' $$,
  'a later change waits while an earlier one on the same meal is still held');
reset role;

update public.decision_notices set claimed_until = now() - interval '1 second'
where meal_id = 'a0000000-0000-0000-0000-000000000002' and claimed_until is not null;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select results_eq(
  $$ select previous_place_name, place_name from public.claim_decision_notices()
     where meal_id = 'a0000000-0000-0000-0000-000000000002' order by id $$,
  $$ values (null::text, 'Ichiran'::text), ('Ichiran', null) $$,
  'once the hold runs out, the meal''s notices are taken together, oldest first');
reset role;

-- Deleting a trip takes all of it along ---------------------------------------------------------

insert into public.decisions (meal_id, proposal_id, decided_by)
values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ delete from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a trip with decisions, notices and emails can still be deleted');
select is(
  (select count(*)::int from public.decision_notices), 0,
  'its notices go with it, and deleting its decisions leaves none behind');
select is(
  (select count(*)::int from public.email_outbox where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0,
  'as do its emails');

select * from finish();
rollback;
