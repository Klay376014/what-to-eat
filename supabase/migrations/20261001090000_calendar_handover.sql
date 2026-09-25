-- Calendar handover and recovery (#13). See docs/adr/0008-calendar-handover.md.
--
-- The trip's calendar lives on one member's Google account, written with
-- their refresh token (#12). That connection will die: Google drops a
-- refresh token left unused for six months, the holder may revoke access or
-- delete the calendar, or leave the trip. A calendar that silently stopped
-- updating is worse than none, so the grant now says when it stopped working
-- and why, every member sees it, and any member can take the calendar over.
--
-- Taking over makes a new secondary calendar on the new holder's account, and
-- every decided meal is queued again to be written there, through the same
-- queue as any other change (ADR 0006). The old calendar cannot be deleted
-- by the app, since the authorisation that would allow it is the one that
-- failed; the grant remembers whose it was so the new holder can be told to
-- ask them.

-- What the grant now records ------------------------------------------------------------

alter table public.calendar_grants
  -- Dropped once the connection is known dead, or its holder has gone: a
  -- token nobody should use is not kept.
  alter column refresh_token drop not null,
  -- When the calendar stopped being written to, and why:
  --   revoked        Google refused the token (invalid_grant, or a 401):
  --                  revoked by the holder, or expired from disuse.
  --   calendar_gone  the trip calendar was deleted from the holder's account.
  --   holder_left    the holder left the trip or was removed.
  add column lapsed_at timestamptz,
  add column lapse_reason text
    check (lapse_reason in ('revoked', 'calendar_gone', 'holder_left')),
  -- After a takeover: whose calendar this one replaced, which is still on
  -- their account with the trip's old events, for them to delete. Cleared
  -- when either of them says it is gone.
  add column previous_holder_id uuid references auth.users (id) on delete set null,
  add column previous_calendar_id text,
  -- Appended to each event id on this calendar (calendarEvent.ts). An
  -- attendee's copy of an event keeps the id it was sent with, so a new
  -- calendar's events take ids of their own rather than reuse the old
  -- calendar's. Empty for calendars connected before this migration, whose
  -- events were written with the bare meal id.
  add column event_suffix text not null default ''
    check (event_suffix ~ '^[0-9a-v]*$'),
  add constraint calendar_grants_lapse_check
    check ((lapsed_at is null) = (lapse_reason is null)),
  add constraint calendar_grants_token_check
    check (refresh_token is not null or lapsed_at is not null);

-- Every calendar made from now on: ten hex digits, which are base32hex too.
alter table public.calendar_grants
  alter column event_suffix set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

-- A new calendar gets every decided meal ----------------------------------------------------
-- When the trip's calendar becomes a different one (a takeover, or a first
-- calendar for meals written to one that is gone), each meal written to
-- another calendar is queued afresh for this one, with no event id: its
-- event is made anew. A meal never written anywhere is waiting already. A
-- meal whose decision was cleared and whose event is on another calendar is
-- dropped: nothing to delete on this one, and the old calendar is out of
-- reach.

create function private.queue_for_new_calendar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.calendar_id is null
    or (tg_op = 'UPDATE' and old.calendar_id is not distinct from new.calendar_id) then
    return null;
  end if;

  delete from public.calendar_events e
  where e.trip_id = new.trip_id
    and e.calendar_id <> new.calendar_id
    and not exists (select 1 from public.decisions d where d.meal_id = e.meal_id);

  -- The claim goes too: a pass still writing to the old calendar would
  -- otherwise keep these from the first pass on the new one. Its outcome is
  -- recorded against the revision it claimed, so it changes nothing here.
  update public.calendar_events e
  set status = 'pending',
      revision = e.revision + 1,
      queued_at = now(),
      error = null,
      event_id = null,
      calendar_id = null,
      claimed_until = null
  where e.trip_id = new.trip_id
    and e.calendar_id <> new.calendar_id;

  return null;
end;
$$;

create trigger calendar_grants_queue_new_calendar
  after insert or update of calendar_id on public.calendar_grants
  for each row execute function private.queue_for_new_calendar();

-- The holder leaving ---------------------------------------------------------------------
-- Leaving or being removed marks their calendar as needing a new holder, and
-- drops their token: the app stops writing to the account of someone no
-- longer in the trip. The grant stays, so the members left see whose it was.

create function private.lapse_departed_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calendar_grants g
  set lapsed_at = coalesce(g.lapsed_at, now()),
      lapse_reason = 'holder_left',
      refresh_token = null
  where g.trip_id = new.trip_id
    and g.holder_id = new.user_id;
  return null;
end;
$$;

create trigger trip_members_lapse_calendar
  after update of left_at on public.trip_members
  for each row
  when (old.left_at is null and new.left_at is not null)
  execute function private.lapse_departed_holder();

-- The Edge Function's side -----------------------------------------------------------------
-- Both name the calendar they are about, so a pass that started before a
-- takeover cannot mark the new calendar lapsed, and of two members taking
-- over at once only one wins.

-- Records that the trip's calendar stopped working, as a pass using
-- `refresh_token` found. False when the trip has moved on to another
-- calendar or another token (its holder connected again meanwhile), or the
-- lapse is already recorded.
create function public.lapse_calendar(
  trip_id uuid,
  calendar_id text,
  refresh_token text,
  reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.calendar_grants g
  set lapsed_at = now(),
      lapse_reason = lapse_calendar.reason,
      refresh_token = null
  where g.trip_id = lapse_calendar.trip_id
    and g.calendar_id = lapse_calendar.calendar_id
    and g.refresh_token = lapse_calendar.refresh_token
    and g.lapsed_at is null;
  return found;
end;
$$;

-- Hands the trip's calendar to `holder_id`, whose new calendar `calendar_id`
-- has just been made with `refresh_token`, if the trip is still on
-- `from_calendar_id`. The old holder is remembered as the one to ask to
-- delete their calendar, unless it was deleted already. That includes a
-- holder taking over from themselves: their old calendar was not found from
-- the account they connected now, which may be a different Google account.
--
-- Only the latest old calendar is remembered: a second takeover before the
-- first old calendar is dismissed replaces the note.
create function public.hand_over_calendar(
  trip_id uuid,
  from_calendar_id text,
  holder_id uuid,
  refresh_token text,
  calendar_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  grant_row public.calendar_grants;
  old_calendar_left boolean;
begin
  select * into grant_row
  from public.calendar_grants g
  where g.trip_id = hand_over_calendar.trip_id
    and g.calendar_id = hand_over_calendar.from_calendar_id
  for update;

  if not found then
    return false;
  end if;

  old_calendar_left := grant_row.lapse_reason is distinct from 'calendar_gone';

  update public.calendar_grants g
  set holder_id = hand_over_calendar.holder_id,
      refresh_token = hand_over_calendar.refresh_token,
      calendar_id = hand_over_calendar.calendar_id,
      connected_at = now(),
      lapsed_at = null,
      lapse_reason = null,
      event_suffix = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
      previous_holder_id = case when old_calendar_left then grant_row.holder_id end,
      previous_calendar_id = case when old_calendar_left then grant_row.calendar_id end
  where g.trip_id = hand_over_calendar.trip_id;
  return true;
end;
$$;

-- The members' side -----------------------------------------------------------------------
-- The note telling the new holder to have the old calendar deleted stays
-- until the new holder or the old one, both in the trip, says it is done.

create function public.forget_previous_calendar(trip_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if not exists (
    select 1
    from public.calendar_grants g
    join public.trip_members m on m.trip_id = g.trip_id
    where g.trip_id = forget_previous_calendar.trip_id
      and m.user_id = caller
      and m.left_at is null
      and caller in (g.holder_id, g.previous_holder_id)
  ) then
    raise exception 'only the calendar''s holder or the previous one can do that'
      using errcode = '42501';
  end if;

  update public.calendar_grants g
  set previous_holder_id = null,
      previous_calendar_id = null
  where g.trip_id = forget_previous_calendar.trip_id;
end;
$$;

-- Grants ----------------------------------------------------------------------------------
-- Members read the new columns but the event suffix, which is the Edge
-- Function's business; the refresh token stays unreadable to every client.

grant select (lapsed_at, lapse_reason, previous_holder_id, previous_calendar_id)
  on public.calendar_grants to authenticated;

revoke all on function private.queue_for_new_calendar() from public, anon, authenticated, service_role;
revoke all on function private.lapse_departed_holder() from public, anon, authenticated, service_role;

revoke all on function public.lapse_calendar(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.hand_over_calendar(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.forget_previous_calendar(uuid) from public, anon, authenticated;
grant execute on function public.lapse_calendar(uuid, text, text, text) to service_role;
grant execute on function public.hand_over_calendar(uuid, text, uuid, text, text) to service_role;
grant execute on function public.forget_previous_calendar(uuid) to authenticated;
