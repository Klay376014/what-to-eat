-- The notify Edge Function, called by the database every minute (#15).
-- See docs/adr/0009-email-notifications.md.
--
-- pg_cron runs private.kick_notify() once a minute. It asks the function to
-- run (pg_net, an HTTP POST made after the transaction commits) only when
-- there is something to do: an email due, a decision notice waiting, or a
-- trip past 08:00 on its own clock with no digest yet today. So most minutes
-- nothing leaves the database.
--
-- The function's URL and the shared secret it checks are kept in Supabase
-- Vault, never in a migration: until both are there (README, "Emails"),
-- kick_notify does nothing, which is also the case locally and in CI.
--
-- A paused free-tier project runs no cron (the keepalive, #2, stops it
-- pausing). A decision still gets its email straight away while the app is
-- open: the app calls the function itself after deciding.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Whether a notify pass has anything to do at `moment`. Mirrors, loosely, what
-- the function decides for itself; the function is the judge
-- (apps/web/src/notifications/digestSchedule.ts), this only saves calling it
-- for nothing. A trip's digest counts as due once 08:00 has passed on its
-- clock, until the function records that day's run, which it does even for
-- a day with nothing new.
create function private.email_work_waiting(moment timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.email_outbox o
      where o.status = 'pending'
        and o.next_attempt_at <= moment
        and (o.claimed_until is null or o.claimed_until < moment)
    )
    or exists (
      select 1 from public.decision_notices n
      where n.processed_at is null
        and (n.claimed_until is null or n.claimed_until < moment)
    )
    or exists (
      select 1
      from public.trips t
      cross join lateral (select (moment at time zone t.timezone) as local_now) l
      where l.local_now::time >= time '08:00'
        and (t.end_date is null or t.end_date >= l.local_now::date)
        and not exists (
          select 1 from public.digest_runs r
          where r.trip_id = t.id and r.local_date >= l.local_now::date
        )
    )
$$;

-- Asks the notify function to run, when there is work and Vault holds its
-- address and secret. Returns pg_net's request id, or null when it asked
-- nothing. The secret goes in a header the function compares; it is not a
-- Supabase key and opens nothing else.
create function private.kick_notify()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not private.email_work_waiting(now()) then
    return null;
  end if;

  select s.decrypted_secret into url from vault.decrypted_secrets s where s.name = 'notify_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'notify_secret';
  if url is null or secret is null then
    return null;
  end if;

  return net.http_post(
    url := url,
    body := '{"action": "run"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.email_work_waiting(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.kick_notify() from public, anon, authenticated, service_role;

-- By name, so running this again replaces the job rather than adding one.
select cron.schedule('notify', '* * * * *', 'select private.kick_notify()');
