-- The notify schedule (#15): once a minute, pg_cron asks the notify Edge
-- Function to run, but only when there is work, and only once Vault holds
-- the function's address and secret. A trip's digest is work from 08:00 on
-- its own clock until that day's digest is recorded.
begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser');

-- Digests are due from 08:00 on the trip's clock ----------------------------------------------

select ok(not private.email_work_waiting('2026-10-02 22:59+00'),
  'nothing is due at 07:59 in Tokyo');
select ok(private.email_work_waiting('2026-10-02 23:00+00'),
  'at 08:00 in Tokyo, 23:00 UTC the day before, the day''s digest is due');
select ok(private.email_work_waiting('2026-10-03 14:59+00'),
  'and stays due until the day ends there');
select ok(not private.email_work_waiting('2026-10-03 15:00+00'),
  'at midnight in Tokyo nothing is due until 08:00');

insert into public.digest_runs (trip_id, local_date, cut_off)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', '2026-10-02 23:00+00');

select ok(not private.email_work_waiting('2026-10-03 01:00+00'),
  'once the day''s digest is recorded, it is not due again');
select ok(private.email_work_waiting('2026-10-03 23:00+00'),
  'the next day''s is, at the next 08:00');
select ok(not private.email_work_waiting('2026-10-06 23:00+00'),
  'a trip that has ended is not due at all');

-- Waiting emails and decision notices are work ------------------------------------------------

insert into public.email_outbox (dedupe_key, kind, trip_id, recipient_id, subject, body_text, body_html, next_attempt_at)
values ('decision:1:alice', 'decision', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 's', 't', 'h', '2026-10-03 02:00+00');

select ok(not private.email_work_waiting('2026-10-03 01:59+00'),
  'an email due later is not work yet');
select ok(private.email_work_waiting('2026-10-03 02:00+00'),
  'an email that is due is');

delete from public.email_outbox;
insert into public.meals (id, trip_id, date, slot) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner');
insert into public.decision_notices (meal_id, trip_id, place_name)
values ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Afuri');

select ok(private.email_work_waiting('2026-10-03 01:00+00'),
  'a decision waiting to be emailed is work');

-- Asking the function ---------------------------------------------------------------------------

select is(private.kick_notify(), null,
  'with no address or secret in Vault, the function is not asked');

select vault.create_secret('https://example.supabase.co/functions/v1/notify', 'notify_url');
select vault.create_secret('s3cret-for-notify', 'notify_secret');

select isnt(private.kick_notify(), null, 'with both, and work waiting, it is asked');
select results_eq(
  $$ select method::text, headers ->> 'x-notify-secret' from net.http_request_queue
     where url = 'https://example.supabase.co/functions/v1/notify' $$,
  $$ values ('POST'::text, 's3cret-for-notify'::text) $$,
  'by a POST carrying the shared secret');

select ok(
  exists (select 1 from cron.job
          where jobname = 'notify' and schedule = '* * * * *'
            and command = 'select private.kick_notify()'),
  'pg_cron runs it every minute');

select * from finish();
rollback;
