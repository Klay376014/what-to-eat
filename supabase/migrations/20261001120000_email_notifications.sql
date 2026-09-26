-- Email: the daily digest per trip, and an email when a meal is decided (#15).
-- See docs/adr/0009-email-notifications.md.
--
-- Emails are sent by the notify Edge Function (supabase/functions/notify)
-- through Resend. The database decides nothing about wording; it holds what
-- has to survive a crash or a retry:
--
--   decision_notices  every decision made, changed or cleared, with the
--                     restaurant before and after, waiting to be emailed.
--   digest_runs       one row per trip per day on the trip's clock: the
--                     digest for that day has been composed, and where it
--                     was cut off, which is where the next one starts.
--   email_outbox      one row per email to one member, under a key fixed by
--                     what the email is for. A key is composed once and sent
--                     once; the key also goes to Resend as its
--                     Idempotency-Key, so a send whose answer was lost is not
--                     a second email either. The nudge (#16) uses it too.
--
-- None of it is readable by any client: the outbox holds what others were
-- told. Only service_role, through the functions below, touches it.

-- Decision notices ---------------------------------------------------------------

create table public.decision_notices (
  id bigint generated always as identity primary key,
  meal_id uuid not null references public.meals (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- The decided proposal and its name before the change (null: undecided)
  -- and after it (null: cleared). Names are kept as they were then.
  previous_proposal_id uuid,
  previous_place_name text,
  proposal_id uuid,
  place_name text,
  -- Who made the change. Their own email leaves them out.
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- While a pass composes its emails, so a second pass leaves it alone.
  claimed_until timestamptz,
  -- When its emails were put in the outbox.
  processed_at timestamptz
);

create index decision_notices_waiting_idx on public.decision_notices (trip_id)
  where processed_at is null;
create index decision_notices_meal_id_idx on public.decision_notices (meal_id);
create index decision_notices_actor_id_idx on public.decision_notices (actor_id);

-- A decision made, changed or cleared leaves a notice. The meal is read here,
-- not trusted from the row: when a trip or meal is deleted, the cascade
-- reaches decisions after the meal is gone, and there is nobody to tell.
--
-- Who acted: the decision's decider when made or changed (prepare_decision
-- makes a change the changer's), the caller when cleared.
--
-- SECURITY DEFINER: the member whose change fires it has no privilege on
-- decision_notices. It records only the row that fired it.
create function private.record_decision_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_id uuid := case when tg_op <> 'INSERT' then old.proposal_id end;
  after_id uuid := case when tg_op <> 'DELETE' then new.proposal_id end;
begin
  insert into public.decision_notices (
    meal_id, trip_id, previous_proposal_id, previous_place_name, proposal_id, place_name, actor_id
  )
  select m.id, m.trip_id,
    before_id, (select p.place_name from public.proposals p where p.id = before_id),
    after_id, (select p.place_name from public.proposals p where p.id = after_id),
    case when tg_op = 'DELETE' then (select auth.uid()) else new.decided_by end
  from public.meals m
  where m.id = coalesce(new.meal_id, old.meal_id);
  return null;
end;
$$;

create trigger decisions_notice_made
  after insert or delete on public.decisions
  for each row execute function private.record_decision_notice();

-- Re-sending the same proposal changes nothing, so tells nobody anything.
create trigger decisions_notice_changed
  after update of proposal_id on public.decisions
  for each row
  when (old.proposal_id is distinct from new.proposal_id)
  execute function private.record_decision_notice();

-- Digest runs ------------------------------------------------------------------------

create table public.digest_runs (
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- The day on the trip's clock whose 08:00 digest this is.
  local_date date not null,
  -- Proposals made before this are in this digest or an earlier one.
  cut_off timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (trip_id, local_date)
);

-- The outbox -------------------------------------------------------------------------

create type public.email_status as enum ('pending', 'sent', 'failed', 'cancelled');

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  -- What the email is for and to whom, e.g. "digest:<trip>:<day>:<member>".
  -- Also Resend's Idempotency-Key (at most 256 characters).
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 256),
  kind text not null check (kind in ('digest', 'decision')),
  trip_id uuid not null references public.trips (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 998),
  body_text text not null,
  body_html text not null,
  status public.email_status not null default 'pending',
  -- Sends tried so far; each claim is one.
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_until timestamptz,
  last_error text,
  -- Resend's id for the email, once sent.
  provider_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_waiting_idx on public.email_outbox (next_attempt_at)
  where status = 'pending';
create index email_outbox_trip_id_idx on public.email_outbox (trip_id);
create index email_outbox_recipient_id_idx on public.email_outbox (recipient_id);

-- Puts emails in the outbox, each once: a key already there is left as it
-- is, whatever became of it. Only to current members of the trip: someone
-- who left between composing and here is not written to. `emails` is a JSON
-- array of {dedupe_key, recipient_id, subject, text, html}.
create function private.enqueue_emails(kind text, trip_id uuid, emails jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer;
begin
  insert into public.email_outbox (dedupe_key, kind, trip_id, recipient_id, subject, body_text, body_html)
  select e.dedupe_key, enqueue_emails.kind, enqueue_emails.trip_id, e.recipient_id,
    e.subject, e.text, e.html
  from jsonb_to_recordset(coalesce(emails, '[]'::jsonb))
    as e(dedupe_key text, recipient_id uuid, subject text, text text, html text)
  where exists (
    select 1 from public.trip_members m
    where m.trip_id = enqueue_emails.trip_id
      and m.user_id = e.recipient_id
      and m.left_at is null
  )
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

-- The notify Edge Function's side -------------------------------------------------------
-- In public so PostgREST serves them, and executable by service_role alone.

-- A trip's members, by the address on their account, those who left
-- included (a departed decider is still named). auth.users is not readable
-- through the Data API. Deliberately not calendar_attendees(): opting out of
-- calendar invitations (#14) does not opt out of the app's own email.
create function public.trip_contacts(trip_id uuid)
returns table (user_id uuid, email text, name text, left_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, p.display_name, m.left_at
  from public.trip_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.trip_id = trip_contacts.trip_id
  order by m.joined_at, m.user_id
$$;

-- Every trip, with the day and cut-off of its last digest, for the function
-- to work out which are due (apps/web/src/notifications/digestSchedule.ts).
create function public.digest_trips()
returns table (
  trip_id uuid,
  name text,
  timezone text,
  end_date date,
  last_date date,
  last_cut_off timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, t.timezone, t.end_date, r.local_date, r.cut_off
  from public.trips t
  left join lateral (
    select d.local_date, d.cut_off from public.digest_runs d
    where d.trip_id = t.id
    order by d.local_date desc
    limit 1
  ) r on true
$$;

-- What a digest is made from: the trip's meals from `from_date` on, each
-- with whether it is decided and its proposals, their proposers' names and
-- who has voted on them.
create function public.digest_meals(trip_id uuid, from_date date)
returns table (
  id uuid,
  date date,
  slot public.meal_slot,
  label text,
  "position" bigint,
  start_time time,
  decided boolean,
  proposals jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.date, m.slot, m.label, m.position, m.start_time,
    exists (select 1 from public.decisions d where d.meal_id = m.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'placeName', p.place_name,
          'proposedBy', p.proposed_by,
          'proposerName', pr.display_name,
          'createdAt', p.created_at,
          'voterIds', coalesce(
            (select jsonb_agg(v.voter_id) from public.votes v where v.proposal_id = p.id),
            '[]'::jsonb)
        ) order by p.created_at)
      from public.proposals p
      left join public.profiles pr on pr.id = p.proposed_by
      where p.meal_id = m.id
    ), '[]'::jsonb)
  from public.meals m
  where m.trip_id = digest_meals.trip_id
    and m.date >= digest_meals.from_date
  order by m.date, m.position
$$;

-- Records a trip's digest for `local_date` and puts its emails in the
-- outbox, together. Only the first pass to record a day does: a second,
-- retried or racing, gets false and adds nothing. A day with nothing new
-- is still recorded, with no emails, so it is not composed again.
create function public.record_digest(
  trip_id uuid,
  local_date date,
  cut_off timestamptz,
  emails jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.digest_runs (trip_id, local_date, cut_off)
  values (record_digest.trip_id, record_digest.local_date, record_digest.cut_off)
  on conflict do nothing;
  if not found then
    return false;
  end if;
  perform private.enqueue_emails('digest', record_digest.trip_id, emails);
  return true;
end;
$$;

-- Takes the decision notices waiting to be emailed (of one trip, or of all
-- with null), with what their emails need, and holds them for five minutes.
--
-- A meal's notices are taken all together or not at all: a meal with any
-- notice still held by another pass (or by one that failed, until its hold
-- runs out) is left alone, so its emails are never composed out of order,
-- and a notice whose pass failed is taken again with the ones after it and
-- becomes one email for where they all ended up. Claims take turns (an
-- advisory lock for the transaction), so two passes cannot split a meal.
create function public.claim_decision_notices(only_trip uuid default null)
returns table (
  id bigint,
  meal_id uuid,
  trip_id uuid,
  trip_name text,
  date date,
  slot public.meal_slot,
  label text,
  start_time time,
  previous_proposal_id uuid,
  previous_place_name text,
  proposal_id uuid,
  place_name text,
  actor_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.claim_decision_notices'));

  return query
  with claimed as (
    update public.decision_notices n
    set claimed_until = now() + interval '5 minutes'
    where n.processed_at is null
      and (only_trip is null or n.trip_id = only_trip)
      and not exists (
        select 1 from public.decision_notices held
        where held.meal_id = n.meal_id
          and held.processed_at is null
          and held.claimed_until >= now()
      )
    returning n.*
  )
  select c.id, c.meal_id, c.trip_id, t.name, m.date, m.slot, m.label, m.start_time,
    c.previous_proposal_id, c.previous_place_name, c.proposal_id, c.place_name, c.actor_id
  from claimed c
  join public.meals m on m.id = c.meal_id
  join public.trips t on t.id = c.trip_id
  order by c.meal_id, c.id;
end;
$$;

-- Puts a meal's decision emails in the outbox and marks the notices they
-- were composed from as done, together. Repeating it adds nothing.
create function public.record_decision_emails(notice_ids bigint[], trip_id uuid, emails jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_emails('decision', record_decision_emails.trip_id, emails);
  update public.decision_notices n
  set processed_at = now(), claimed_until = null
  where n.id = any (notice_ids)
    and n.trip_id = record_decision_emails.trip_id;
end;
$$;

-- Takes up to `max_count` emails due to be sent (of one trip, or of all with
-- null), with the recipient's address as it is now, and holds them for five
-- minutes. An email to someone who has since left the trip, or who has no
-- address, is cancelled instead: they stop hearing about the trip at once.
create function public.claim_emails(only_trip uuid default null, max_count integer default 25)
returns table (
  id uuid,
  dedupe_key text,
  to_email text,
  subject text,
  body_text text,
  body_html text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.email_outbox o
  set status = 'cancelled', claimed_until = null,
      last_error = 'The recipient is no longer in the trip.'
  where o.status = 'pending'
    and (only_trip is null or o.trip_id = only_trip)
    and not exists (
      select 1
      from public.trip_members m
      join auth.users u on u.id = m.user_id
      where m.trip_id = o.trip_id
        and m.user_id = o.recipient_id
        and m.left_at is null
        and u.email is not null
    );

  return query
  with claimed as (
    update public.email_outbox o
    set claimed_until = now() + interval '5 minutes',
        attempts = o.attempts + 1
    where o.id in (
      select q.id from public.email_outbox q
      where q.status = 'pending'
        and q.next_attempt_at <= now()
        and (q.claimed_until is null or q.claimed_until < now())
        and (only_trip is null or q.trip_id = only_trip)
      order by q.created_at
      limit greatest(claim_emails.max_count, 0)
      for update skip locked
    )
    returning o.id, o.dedupe_key, o.recipient_id, o.subject, o.body_text, o.body_html, o.created_at
  )
  select c.id, c.dedupe_key, u.email::text, c.subject, c.body_text, c.body_html
  from claimed c
  join auth.users u on u.id = c.recipient_id
  order by c.created_at;
end;
$$;

-- Records a send. Sent: done, with Resend's id. Failed but worth retrying
-- (`retry`): due again after 1, 2, 4, 8 then 16 minutes, and given up after
-- the sixth try, well inside the 24 hours Resend keeps a key. Otherwise
-- failed for good. Only a pending email changes, so a late answer cannot
-- undo a send.
create function public.finish_email(id uuid, provider_id text, error text, retry boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if finish_email.error is null then
    update public.email_outbox o
    set status = 'sent', sent_at = now(), provider_id = finish_email.provider_id,
        last_error = null, claimed_until = null
    where o.id = finish_email.id and o.status = 'pending';
  else
    update public.email_outbox o
    set status = case when finish_email.retry and o.attempts < 6
                   then 'pending'::public.email_status else 'failed' end,
        next_attempt_at = now() + interval '1 minute' * power(2, greatest(o.attempts - 1, 0)),
        last_error = left(finish_email.error, 500),
        claimed_until = null
    where o.id = finish_email.id and o.status = 'pending';
  end if;
end;
$$;

-- RLS and grants -------------------------------------------------------------------------
-- RLS on with no policy: no client reads or writes any of it. service_role
-- bypasses RLS but has no table grants either; it goes through the
-- functions above.

alter table public.decision_notices enable row level security;
alter table public.digest_runs enable row level security;
alter table public.email_outbox enable row level security;

revoke all on public.decision_notices from anon, authenticated, service_role;
revoke all on public.digest_runs from anon, authenticated, service_role;
revoke all on public.email_outbox from anon, authenticated, service_role;

revoke all on function private.record_decision_notice() from public, anon, authenticated, service_role;
revoke all on function private.enqueue_emails(text, uuid, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.trip_contacts(uuid) from public, anon, authenticated;
revoke all on function public.digest_trips() from public, anon, authenticated;
revoke all on function public.digest_meals(uuid, date) from public, anon, authenticated;
revoke all on function public.record_digest(uuid, date, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.claim_decision_notices(uuid) from public, anon, authenticated;
revoke all on function public.record_decision_emails(bigint[], uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_emails(uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_email(uuid, text, text, boolean) from public, anon, authenticated;

grant execute on function public.trip_contacts(uuid) to service_role;
grant execute on function public.digest_trips() to service_role;
grant execute on function public.digest_meals(uuid, date) to service_role;
grant execute on function public.record_digest(uuid, date, timestamptz, jsonb) to service_role;
grant execute on function public.claim_decision_notices(uuid) to service_role;
grant execute on function public.record_decision_emails(bigint[], uuid, jsonb) to service_role;
grant execute on function public.claim_emails(uuid, integer) to service_role;
grant execute on function public.finish_email(uuid, text, text, boolean) to service_role;
