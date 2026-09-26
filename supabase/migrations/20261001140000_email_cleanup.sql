-- Email cleanup (#15): what the email tables keep, and for how long.
-- See docs/adr/0009-email-notifications.md.
--
-- The outbox holds every email with its content, so it is not kept for
-- good. Once a day, pg_cron deletes what is done with and older than
-- private.email_retention(), 30 days unless changed there:
--
--   email_outbox      emails sent, given up on, or cancelled. Never one
--                     still pending or being sent, however old.
--   decision_notices  notices whose emails were composed. Never one still
--                     waiting: it has not been emailed yet.
--   digest_runs       runs older than that, but never a trip's latest.
--
-- None of it can make an email be composed or sent again:
--   - A deleted email's key could only come back from composing it again.
--     A decision key names a notice, and processed notices are never
--     claimed again (and identity ids are never reused). A digest key names
--     a day, and only today's digest is ever composed.
--   - A trip's latest digest run says which day it last had and where its
--     next digest starts (digest_trips). Keeping it means no past day looks
--     due, and no trip looks as if it never had a digest, which would give
--     it a "first digest". Older runs say nothing the latest does not.

-- The one place the retention period is set.
create function private.email_retention()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '30 days' $$;

-- Deletes what is past retention, `batch_size` rows per statement so no one
-- statement holds many locks, and reports how many rows went from each table.
create function private.prune_email_records(batch_size integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before timestamptz := now() - private.email_retention();
  step integer := greatest(batch_size, 1);
  n integer;
  emails integer := 0;
  notices integer := 0;
  runs integer := 0;
begin
  loop
    delete from public.email_outbox o
    where o.id in (
      select q.id from public.email_outbox q
      where q.status in ('sent', 'failed', 'cancelled')
        and q.created_at < before
      limit step
    );
    get diagnostics n = row_count;
    emails := emails + n;
    exit when n < step;
  end loop;

  loop
    delete from public.decision_notices d
    where d.id in (
      select q.id from public.decision_notices q
      where q.processed_at is not null
        and q.processed_at < before
      limit step
    );
    get diagnostics n = row_count;
    notices := notices + n;
    exit when n < step;
  end loop;

  loop
    delete from public.digest_runs r
    where (r.trip_id, r.local_date) in (
      select q.trip_id, q.local_date from public.digest_runs q
      where q.cut_off < before
        and exists (
          select 1 from public.digest_runs later
          where later.trip_id = q.trip_id and later.local_date > q.local_date
        )
      limit step
    );
    get diagnostics n = row_count;
    runs := runs + n;
    exit when n < step;
  end loop;

  return jsonb_build_object('emails', emails, 'notices', notices, 'digest_runs', runs);
end;
$$;

-- For the schedule (the migration role) alone: no client, and not the Edge
-- Function either.
revoke all on function private.email_retention() from public, anon, authenticated, service_role;
revoke all on function private.prune_email_records(integer) from public, anon, authenticated, service_role;

-- By name, so running this again replaces the job rather than adding one.
select cron.schedule('prune-emails', '0 3 * * *', 'select private.prune_email_records()');
