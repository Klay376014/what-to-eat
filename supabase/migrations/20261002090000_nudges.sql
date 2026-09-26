-- Nudges (#16): any member emails the people with no vote on a meal, at most
-- once per meal every six hours. See docs/adr/0010-nudges.md.
--
--   meal_nudges   one row per nudge: which meal, who, when, and whether its
--                 emails have been composed. The latest row of a meal is its
--                 cooldown. Members read when and by whom (the button shows
--                 how long is left); nobody writes it but nudge_meal.
--   nudge_meal    the only way to nudge. Refuses, in the database, a nudge
--                 within six hours of the meal's last, from anyone who is
--                 not a current member, on a decided meal, on one with
--                 nothing to vote on, or where everyone else has voted.
--
-- The emails go through #15's outbox (20261001120000_email_notifications.sql)
-- under `nudge:<nudge>:<member>`: the notify Edge Function claims waiting
-- nudges, composes one email per current member with no vote on the meal as
-- it then stands, never the nudger (apps/web/src/notifications/compose.ts),
-- and records them. The app asks the function straight after nudging; the
-- once-a-minute schedule is the backstop.

-- The table ------------------------------------------------------------------------------------

create table public.meal_nudges (
  id bigint generated always as identity primary key,
  meal_id uuid not null references public.meals (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- Who nudged. Left out of their own nudge's emails.
  nudged_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- While a pass composes its emails, so a second pass leaves it alone.
  claimed_until timestamptz,
  -- When its emails were put in the outbox.
  processed_at timestamptz
);

create index meal_nudges_meal_idx on public.meal_nudges (meal_id, created_at desc);
create index meal_nudges_waiting_idx on public.meal_nudges (trip_id) where processed_at is null;
create index meal_nudges_nudged_by_idx on public.meal_nudges (nudged_by);

-- The one place the cooldown is set. apps/web/src/proposals/nudge.ts has the
-- same six hours, for the button only.
create function private.nudge_cooldown()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '6 hours' $$;

-- Nudging -----------------------------------------------------------------------------------------
-- Returns when the meal was nudged. Refusals (P0001, the message is the
-- reason): nudge_cooldown, with DETAIL the moment it can next be nudged (ISO
-- 8601); meal_decided; nothing_to_vote_on; everyone_voted. Someone not
-- currently in the meal's trip, or a meal that does not exist, gets 42501.
--
-- The cooldown is exact: a nudge six hours or more after the meal's last is
-- allowed, one a moment sooner is not. Two members nudging the same meal at
-- once take turns on the meal's row lock (FOR NO KEY UPDATE, like the vote
-- triggers, so it does not block votes or proposals on the meal), so only
-- one of them gets through.
--
-- SECURITY DEFINER: members hold no write grant on meal_nudges, so the
-- cooldown cannot be skipped by writing the table directly.
create function public.nudge_meal(meal_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  trip uuid;
  last_nudge timestamptz;
  nudged timestamptz;
begin
  select m.trip_id into trip
  from public.meals m
  where m.id = nudge_meal.meal_id
    and m.trip_id in (select private.my_trip_ids())
  for no key update;
  if trip is null then
    raise exception 'only current members of the trip can nudge its meals' using errcode = '42501';
  end if;

  if exists (select 1 from public.decisions d where d.meal_id = nudge_meal.meal_id) then
    raise exception 'meal_decided' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.proposals p where p.meal_id = nudge_meal.meal_id) then
    raise exception 'nothing_to_vote_on' using errcode = 'P0001';
  end if;

  -- Someone to nudge: a current member other than me with no vote on any of
  -- the meal's proposals. A departed member is nobody to nudge.
  if not exists (
    select 1 from public.trip_members tm
    where tm.trip_id = trip
      and tm.left_at is null
      and tm.user_id <> me
      and not exists (
        select 1 from public.votes v
        join public.proposals p on p.id = v.proposal_id
        where p.meal_id = nudge_meal.meal_id
          and v.voter_id = tm.user_id
      )
  ) then
    raise exception 'everyone_voted' using errcode = 'P0001';
  end if;

  select max(n.created_at) into last_nudge
  from public.meal_nudges n
  where n.meal_id = nudge_meal.meal_id;
  if last_nudge > now() - private.nudge_cooldown() then
    raise exception 'nudge_cooldown' using
      errcode = 'P0001',
      detail = to_json(last_nudge + private.nudge_cooldown()) #>> '{}';
  end if;

  insert into public.meal_nudges (meal_id, trip_id, nudged_by)
  values (nudge_meal.meal_id, trip, me)
  returning created_at into nudged;
  return nudged;
end;
$$;

-- The notify Edge Function's side ---------------------------------------------------------------

-- Takes the nudges waiting to be emailed (of one trip, or of all with null),
-- with what their emails need, and holds them for five minutes. Each nudge
-- is its own emails, so there is no order to keep between them. The meal's
-- proposals come with who has voted on each as it stands now, departed
-- voters included (the function leaves them out as recipients).
create function public.claim_nudges(only_trip uuid default null)
returns table (
  id bigint,
  meal_id uuid,
  trip_id uuid,
  trip_name text,
  date date,
  slot public.meal_slot,
  label text,
  start_time time,
  nudged_by uuid,
  decided boolean,
  proposals jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    update public.meal_nudges n
    set claimed_until = now() + interval '5 minutes'
    where n.id in (
      select q.id from public.meal_nudges q
      where q.processed_at is null
        and (q.claimed_until is null or q.claimed_until < now())
        and (only_trip is null or q.trip_id = only_trip)
      for update skip locked
    )
    returning n.*
  )
  select c.id, c.meal_id, c.trip_id, t.name, m.date, m.slot, m.label, m.start_time, c.nudged_by,
    exists (select 1 from public.decisions d where d.meal_id = c.meal_id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'placeName', p.place_name,
          'voterIds', coalesce(
            (select jsonb_agg(v.voter_id order by v.created_at) from public.votes v where v.proposal_id = p.id),
            '[]'::jsonb)
        ) order by p.created_at, p.id)
      from public.proposals p
      where p.meal_id = c.meal_id
    ), '[]'::jsonb)
  from claimed c
  join public.meals m on m.id = c.meal_id
  join public.trips t on t.id = c.trip_id
  order by c.id;
end;
$$;

-- Puts a nudge's emails in the outbox and marks it done, together.
-- Repeating it adds nothing.
create function public.record_nudge_emails(nudge_id bigint, trip_id uuid, emails jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_emails('nudge', record_nudge_emails.trip_id, emails);
  update public.meal_nudges n
  set processed_at = now(), claimed_until = null
  where n.id = record_nudge_emails.nudge_id
    and n.trip_id = record_nudge_emails.trip_id;
end;
$$;

-- The outbox takes nudges --------------------------------------------------------------------------

alter table public.email_outbox drop constraint email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('digest', 'decision', 'nudge'));

-- The schedule counts a waiting nudge as work ------------------------------------------------------
-- As in 20261001130000_notify_schedule.sql, with nudges added.

create or replace function private.email_work_waiting(moment timestamptz default now())
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
      select 1 from public.meal_nudges n
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

-- The daily cleanup deletes emailed nudges too -----------------------------------------------------
-- As in 20261001140000_email_cleanup.sql, with nudges added: those whose
-- emails were composed more than private.email_retention() ago. Never one
-- still waiting. A cooldown only ever looks back six hours, far inside it.

create or replace function private.prune_email_records(batch_size integer default 1000)
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
  nudges integer := 0;
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

  loop
    delete from public.meal_nudges d
    where d.id in (
      select q.id from public.meal_nudges q
      where q.processed_at is not null
        and q.processed_at < before
      limit step
    );
    get diagnostics n = row_count;
    nudges := nudges + n;
    exit when n < step;
  end loop;

  return jsonb_build_object('emails', emails, 'notices', notices, 'digest_runs', runs, 'nudges', nudges);
end;
$$;

-- RLS and grants ------------------------------------------------------------------------------------
-- Members of the trip read who nudged which meal when; nothing else, and no
-- writes. service_role has no table grant either; it goes through the
-- functions.

alter table public.meal_nudges enable row level security;

revoke all on public.meal_nudges from anon, authenticated, service_role;
grant select (id, meal_id, trip_id, nudged_by, created_at) on public.meal_nudges to authenticated;

create policy meal_nudges_select on public.meal_nudges
  for select to authenticated
  using (trip_id in (select private.my_trip_ids()));

revoke all on function private.nudge_cooldown() from public, anon, authenticated, service_role;
revoke all on function private.email_work_waiting(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.prune_email_records(integer) from public, anon, authenticated, service_role;

revoke all on function public.nudge_meal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.nudge_meal(uuid) to authenticated;

revoke all on function public.claim_nudges(uuid) from public, anon, authenticated;
revoke all on function public.record_nudge_emails(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_nudges(uuid) to service_role;
grant execute on function public.record_nudge_emails(bigint, uuid, jsonb) to service_role;
