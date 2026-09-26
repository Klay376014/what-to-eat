-- Email cleanup (#15): once a day, what was sent (or given up on) more than
-- the retention period ago is deleted, and nothing deleted can make an email
-- be composed or sent again: pending emails and unprocessed notices stay, and
-- every trip keeps its latest digest run, which is what says which day it
-- last had and where its next digest starts.
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Home', null, null, 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Quiet', null, null, 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'organiser');

insert into public.meals (id, trip_id, date, slot) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date, 'dinner');

-- The outbox: old and recent, in every state.
insert into public.email_outbox (dedupe_key, kind, trip_id, recipient_id, subject, body_text, body_html, status, created_at)
select k, 'decision', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 's', 't', 'h', st::public.email_status, at
from (values
  ('old-sent', 'sent', now() - interval '31 days'),
  ('old-failed', 'failed', now() - interval '31 days'),
  ('old-cancelled', 'cancelled', now() - interval '31 days'),
  ('old-pending', 'pending', now() - interval '31 days'),
  ('recent-sent', 'sent', now() - interval '29 days')
) as v(k, st, at);

-- Decision notices: old processed, old still waiting, recent processed.
insert into public.decision_notices (meal_id, trip_id, place_name, created_at, processed_at) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Old done', now() - interval '40 days', now() - interval '31 days'),
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Old waiting', now() - interval '40 days', null),
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Recent done', now() - interval '2 days', now() - interval '2 days');

-- Digest runs: Home has many, old and recent; Quiet's only (and so latest)
-- run is older than the retention period.
insert into public.digest_runs (trip_id, local_date, cut_off)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', d::date, d - interval '1 hour'
from generate_series(now() - interval '40 days', now() - interval '1 day', interval '1 day') d;
insert into public.digest_runs (trip_id, local_date, cut_off) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', (now() - interval '60 days')::date, now() - interval '60 days');

create temp table before_runs as
  select t.id, r.local_date, r.cut_off
  from public.trips t
  cross join lateral (
    select d.local_date, d.cut_off from public.digest_runs d
    where d.trip_id = t.id order by d.local_date desc limit 1
  ) r;
grant select on before_runs to service_role;

-- The retention period is one setting ------------------------------------------------------

select is(private.email_retention(), interval '30 days',
  'emails are kept for 30 days by default');

-- Only cron (the migration role) runs it --------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select throws_ok($$ select private.prune_email_records() $$, '42501', null,
  'a member cannot run the cleanup');
reset role;
set local role service_role;
select throws_ok($$ select private.prune_email_records() $$, '42501', null,
  'nor can the Edge Function: it is the schedule''s alone');
reset role;

select ok(
  exists (select 1 from cron.job
          where jobname = 'prune-emails' and schedule = '0 3 * * *'
            and command = 'select private.prune_email_records()'),
  'pg_cron runs it daily at 03:00 UTC');

-- Pruning ---------------------------------------------------------------------------------------

select private.prune_email_records(2);

select is_empty(
  $$ select dedupe_key from public.email_outbox where dedupe_key in ('old-sent', 'old-failed', 'old-cancelled') $$,
  'sent, failed and cancelled emails older than the retention period are gone, however many batches it takes');
select results_eq(
  $$ select dedupe_key from public.email_outbox order by dedupe_key $$,
  $$ values ('old-pending'::text), ('recent-sent') $$,
  'a pending email is never deleted, however old, nor a recent one');

select results_eq(
  $$ select place_name from public.decision_notices order by id $$,
  $$ values ('Old waiting'::text), ('Recent done') $$,
  'processed notices older than the retention period are gone; waiting ones stay');

select is(
  (select count(*)::int from public.digest_runs
   where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and cut_off < now() - interval '30 days'),
  0, 'old digest runs are gone');
select ok(
  (select count(*) from public.digest_runs where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') >= 29,
  'recent ones stay');
select is(
  (select count(*)::int from public.digest_runs where trip_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1, 'a trip''s latest run stays, however old it is');

-- Nothing pruned makes anything due again ---------------------------------------------------------

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select results_eq(
  $$ select trip_id, last_date, last_cut_off from public.digest_trips() order by name $$,
  $$ select id, local_date, cut_off from before_runs order by id $$,
  'every trip''s last digest day and cut-off are as they were, so no past day looks due and no trip looks new');
reset role;

-- The outbox keys of deleted emails cannot be composed again: a digest key
-- is for a day already recorded or past, a decision key for a notice already
-- processed. Running the cleanup twice changes nothing more.
select lives_ok($$ select private.prune_email_records() $$, 'running it again is harmless');
select is((select count(*)::int from public.email_outbox), 2, 'and deletes nothing more');

select results_eq(
  $$ select (r ->> 'emails')::int, (r ->> 'notices')::int, (r ->> 'digest_runs')::int
     from (select private.prune_email_records() as r) x $$,
  $$ values (0, 0, 0) $$,
  'it reports what it deleted');

-- The emails still waiting are still due after the cleanup.
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';
select is(
  (select dedupe_key from public.claim_emails(null, 10)), 'old-pending',
  'a pending email left by the cleanup is still sent');
select is(
  (select place_name from public.claim_decision_notices()), 'Old waiting',
  'and a waiting notice still emailed');
reset role;

select ok(not exists (
    select 1 from public.digest_runs r
    where not exists (select 1 from before_runs b where b.id = r.trip_id)
  ), 'no run was added');

select * from finish();
rollback;
