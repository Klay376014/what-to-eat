-- Calendar: a decided meal becomes an event on the trip's calendar (#12).
--
-- One member authorises Google Calendar for the trip, separately from
-- signing in (ADR 0001), with the calendar.app.created scope. The calendar
-- Edge Function (supabase/functions/calendar) creates a secondary calendar
-- named after the trip on their account, and writes each decided meal to it
-- with the trip's members as attendees, which puts it in their own calendars.
--
-- Writes are queued, not made as the member decides. A decision is a
-- database fact first; a trigger then queues the meal in calendar_events,
-- and the Edge Function works the queue. So a meal can be decided before any
-- calendar is connected (it waits, visibly, as not synced), connecting
-- writes everything waiting in one pass, and a failed write is a status the
-- trip shows rather than a lost decision.
--
-- Handing the calendar to another member, and a lapsed authorisation, are
-- #13's. Leaving someone off the attendee list is #14's.

-- A meal's own start time -----------------------------------------------------
-- Null is the slot's default (apps/web/src/calendar/mealTime.ts). A wall-clock
-- time on the trip's calendar, like every time the app writes: resolved in
-- the trip's timezone only when the event is written. Whole minutes, as the
-- time field sets it.

alter table public.meals
  add column start_time time
    check (start_time = date_trunc('minute', start_time));

-- Any current member may set it, through the meals_update policy that
-- already lets them rename an "other" meal.
grant update (start_time) on public.meals to authenticated;

-- Who holds the trip's calendar -----------------------------------------------
-- One calendar per trip, so the primary key is the trip. The refresh token is
-- what lets the Edge Function write while the holder is away; no client
-- ever reads it (column grants below), only service_role.

create table public.calendar_grants (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  holder_id uuid not null references auth.users (id) on delete cascade,
  refresh_token text not null,
  -- The secondary calendar made for the trip. Null for the moment between
  -- claiming the trip's calendar and Google creating it.
  calendar_id text,
  connected_at timestamptz not null default now()
);

create index calendar_grants_holder_id_idx on public.calendar_grants (holder_id);

-- The queue: each meal's event and whether it is up to date ----------------------
-- A row per meal that has, or should have, an event. `revision` grows with
-- every change the event must follow; the Edge Function records a write
-- against the revision it wrote, so a change made meanwhile keeps the meal
-- queued. `event_id` is kept after the decision is cleared, until the event
-- is deleted; then the row goes.

create type public.calendar_sync_status as enum ('pending', 'synced', 'failed');

create table public.calendar_events (
  meal_id uuid primary key references public.meals (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  status public.calendar_sync_status not null default 'pending',
  revision bigint not null default 1,
  queued_at timestamptz not null default now(),
  event_id text,
  calendar_id text,
  synced_at timestamptz,
  -- Why the last write failed, shown with the meal.
  error text,
  -- While a write is in flight, so two passes do not write one meal at once.
  claimed_until timestamptz
);

create index calendar_events_trip_id_idx on public.calendar_events (trip_id, status);

-- Queueing ------------------------------------------------------------------------
-- A meal is queued when it has a decision, or an event that may need
-- deleting. Its meal row is read here, not trusted from the caller: when a
-- trip is deleted, the cascade reaches decisions after the meals are gone,
-- and then there is nothing to queue.
--
-- SECURITY DEFINER: the member whose change fires these has no privilege on
-- calendar_events. Each trigger passes only meals its own row names.

create function private.queue_calendar_events(meal_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.calendar_events as e (meal_id, trip_id)
  select m.id, m.trip_id
  from public.meals m
  where m.id = any (meal_ids)
    and (
      exists (select 1 from public.decisions d where d.meal_id = m.id)
      or exists (select 1 from public.calendar_events q where q.meal_id = m.id)
    )
  on conflict (meal_id) do update
    set status = 'pending',
        revision = e.revision + 1,
        queued_at = now(),
        error = null
$$;

-- A decision made, changed or cleared.
create function private.queue_decided_meal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_calendar_events(array[coalesce(new.meal_id, old.meal_id)]);
  return null;
end;
$$;

create trigger decisions_queue_calendar
  after insert or update or delete on public.decisions
  for each row execute function private.queue_decided_meal();

-- The meal's time, name or day.
create function private.queue_changed_meal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_calendar_events(array[new.id]);
  return null;
end;
$$;

create trigger meals_queue_calendar
  after update of start_time, label, date on public.meals
  for each row
  when (
    old.start_time is distinct from new.start_time
    or old.label is distinct from new.label
    or old.date is distinct from new.date
  )
  execute function private.queue_changed_meal();

-- The decided restaurant's name, note or place.
create function private.queue_changed_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_calendar_events(
    array(select d.meal_id from public.decisions d where d.proposal_id = new.id)
  );
  return null;
end;
$$;

create trigger proposals_queue_calendar
  after update of place_name, note, lat, lng on public.proposals
  for each row
  when (
    old.place_name is distinct from new.place_name
    or old.note is distinct from new.note
    or old.lat is distinct from new.lat
    or old.lng is distinct from new.lng
  )
  execute function private.queue_changed_proposal();

-- Every decided meal of a trip: its timezone moved every time, or its members
-- (the attendees) changed. The trigger names the column holding the trip.
create function private.queue_trip_meals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  perform private.queue_calendar_events(
    array(select m.id from public.meals m where m.trip_id = trip)
  );
  return null;
end;
$$;

create trigger trips_queue_calendar
  after update of timezone on public.trips
  for each row
  when (old.timezone is distinct from new.timezone)
  execute function private.queue_trip_meals('id');

create trigger trip_members_queue_calendar
  after insert or update of left_at on public.trip_members
  for each row execute function private.queue_trip_meals('trip_id');

-- Meals decided before this migration wait for a calendar like any other.
insert into public.calendar_events (meal_id, trip_id)
select d.meal_id, m.trip_id
from public.decisions d
join public.meals m on m.id = d.meal_id;

-- The Edge Function's side of the queue ---------------------------------------------
-- In public so PostgREST serves them, and executable by service_role alone.

-- Takes the trip's meals that need writing, with what their events need, and
-- holds them for five minutes so a second pass leaves them alone. A meal
-- whose decision was cleared comes with no restaurant: its event is deleted.
create function public.claim_calendar_events(trip_id uuid)
returns table (
  meal_id uuid,
  revision bigint,
  event_id text,
  date date,
  slot public.meal_slot,
  label text,
  start_time time,
  place_name text,
  note text,
  lat double precision,
  lng double precision
)
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    update public.calendar_events e
    set claimed_until = now() + interval '5 minutes'
    where e.meal_id in (
      select q.meal_id
      from public.calendar_events q
      where q.trip_id = claim_calendar_events.trip_id
        and q.status <> 'synced'
        and (q.claimed_until is null or q.claimed_until < now())
      for update skip locked
    )
    returning e.meal_id, e.revision, e.event_id
  )
  select c.meal_id, c.revision, c.event_id, m.date, m.slot, m.label, m.start_time,
    p.place_name, p.note, p.lat, p.lng
  from claimed c
  join public.meals m on m.id = c.meal_id
  left join public.decisions d on d.meal_id = c.meal_id
  left join public.proposals p on p.id = d.proposal_id
  order by m.date, m.position
$$;

-- Records a write. With no error the meal is synced to `event_id` on
-- `calendar_id`, or, with no event, its event is gone and so is the row.
-- With an error it is failed and keeps what it had. Either way the claim is
-- released; if the meal changed since `revision` was claimed, it stays
-- queued for the newer change.
create function public.finish_calendar_event(
  meal_id uuid,
  revision bigint,
  event_id text,
  calendar_id text,
  error text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if finish_calendar_event.error is null and finish_calendar_event.event_id is null then
    delete from public.calendar_events e
    where e.meal_id = finish_calendar_event.meal_id
      and e.revision = finish_calendar_event.revision;
  elsif finish_calendar_event.error is null then
    update public.calendar_events e
    set status = 'synced',
        event_id = finish_calendar_event.event_id,
        calendar_id = finish_calendar_event.calendar_id,
        synced_at = now(),
        error = null
    where e.meal_id = finish_calendar_event.meal_id
      and e.revision = finish_calendar_event.revision;
  else
    update public.calendar_events e
    set status = 'failed',
        error = left(finish_calendar_event.error, 500)
    where e.meal_id = finish_calendar_event.meal_id
      and e.revision = finish_calendar_event.revision;
  end if;

  update public.calendar_events e
  set claimed_until = null
  where e.meal_id = finish_calendar_event.meal_id;
end;
$$;

-- Whom the trip's events invite: its current members, by the email they
-- signed in with, but the calendar's holder, whose calendar has the event
-- already. auth.users is not readable through the Data API, hence this.
create function public.calendar_attendees(trip_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.trip_members m
  join auth.users u on u.id = m.user_id
  where m.trip_id = calendar_attendees.trip_id
    and m.left_at is null
    and u.email is not null
    and m.user_id is distinct from (
      select g.holder_id from public.calendar_grants g
      where g.trip_id = calendar_attendees.trip_id
    )
$$;

-- RLS ---------------------------------------------------------------------
-- A current member sees whether the trip has a calendar and whose, and how
-- each meal's event stands. Nobody but service_role writes either table.

alter table public.calendar_grants enable row level security;
alter table public.calendar_events enable row level security;

create policy calendar_grants_select on public.calendar_grants
  for select to authenticated
  using (trip_id in (select private.my_trip_ids()));

create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (trip_id in (select private.my_trip_ids()));

-- Grants ------------------------------------------------------------------
-- As in the earlier migrations: take back the Data API's default ALL, then
-- grant exactly what the policies are written for. The refresh token is left
-- out of the column grant, so `select refresh_token` and `select *` are
-- refused to every client, the holder included.

revoke all on public.calendar_grants from anon, authenticated, service_role;
grant select (trip_id, holder_id, calendar_id, connected_at) on public.calendar_grants
  to authenticated;
grant select, insert, update, delete on public.calendar_grants to service_role;

revoke all on public.calendar_events from anon, authenticated, service_role;
grant select (meal_id, trip_id, status, revision, queued_at, event_id, calendar_id, synced_at, error)
  on public.calendar_events to authenticated;
grant select, insert, update, delete on public.calendar_events to service_role;

revoke all on function private.queue_calendar_events(uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.queue_decided_meal() from public, anon, authenticated, service_role;
revoke all on function private.queue_changed_meal() from public, anon, authenticated, service_role;
revoke all on function private.queue_changed_proposal() from public, anon, authenticated, service_role;
revoke all on function private.queue_trip_meals() from public, anon, authenticated, service_role;

revoke all on function public.claim_calendar_events(uuid) from public, anon, authenticated;
revoke all on function public.finish_calendar_event(uuid, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.calendar_attendees(uuid) from public, anon, authenticated;
grant execute on function public.claim_calendar_events(uuid) to service_role;
grant execute on function public.finish_calendar_event(uuid, bigint, text, text, text) to service_role;
grant execute on function public.calendar_attendees(uuid) to service_role;
