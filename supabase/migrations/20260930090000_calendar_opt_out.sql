-- Opting out of calendar invitations (#14).
--
-- A decided meal's event invites the trip's members (#12), and Google shows
-- every attendee's email address to every other attendee. That cannot be
-- switched off, and among friends of friends it is not what people expect.
-- So joining says so first (apps/web/src/invitations/InvitationGate.vue),
-- and a member may ask to be left off the attendee list, per trip, at join
-- or at any time after.
--
-- The setting touches the attendee list and nothing else: an opted-out
-- member still reads every decision in the app, and the decision and digest
-- emails, when they come, go to them as to anyone.

-- Who asked to be left off ----------------------------------------------------------
-- A row means "do not invite me to this trip's events"; no row is the
-- default, invited. Keyed on the membership, so it stays with the member
-- through leaving and coming back, and goes with them if their account is
-- deleted.

create table public.calendar_opt_outs (
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  foreign key (trip_id, user_id)
    references public.trip_members (trip_id, user_id) on delete cascade
);

-- Whom the trip's events invite: as in 20260929090000_calendar.sql, now less
-- whoever opted out.
create or replace function public.calendar_attendees(trip_id uuid)
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
    and not exists (
      select 1 from public.calendar_opt_outs o
      where o.trip_id = m.trip_id and o.user_id = m.user_id
    )
$$;

-- Changing it rewrites the trip's events ------------------------------------------------
-- Opting out takes the member off the events already written, and opting back
-- in puts them on, through the queue like any other change an event must
-- follow (ADR 0006). The app asks the calendar Edge Function to write straight
-- after.
--
-- The #12 trigger function that queues a trip's meals when its members
-- change, now reading the deleted row on a DELETE, which opting back in is.

create or replace function private.queue_trip_meals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> tg_argv[0])::uuid;
begin
  perform private.queue_calendar_events(
    array(select m.id from public.meals m where m.trip_id = trip)
  );
  return null;
end;
$$;

create trigger calendar_opt_outs_queue_calendar
  after insert or delete on public.calendar_opt_outs
  for each row execute function private.queue_trip_meals('trip_id');

-- Choosing at join ---------------------------------------------------------------------
-- join_trip() as in 20260925100000_invitations.sql, taking the choice the
-- joining screen offers. It goes in with the membership, in one transaction:
-- set after joining, a calendar write in between (joining queues the trip's
-- events) could already have sent them an invitation.
--
-- When this call makes the caller a member, new or coming back, it sets the
-- setting either way; what they chose before they left is replaced by what
-- they chose now. A member reopening a link sees the same screen (whether
-- they are in the trip is not known until the token is used), so for them
-- only opting out counts: the box starts ticked, and a tick they never
-- touched must not undo an opt-out they made in the trip.
--
-- Dropped and made again, not replaced: a second, overloaded join_trip
-- would make a call with just the token ambiguous.

drop function public.join_trip(text);

create function public.join_trip(token text, calendar_attendee boolean default true)
returns table (trip_id uuid, joined boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller uuid := (select auth.uid());
  invitation public.invitations;
  membership public.trip_members;
begin
  if caller is null then
    raise exception 'join_trip requires a signed-in user' using errcode = '42501';
  end if;

  select * into invitation
  from public.invitations i
  where i.token = join_trip.token;

  if not found then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  perform 1 from public.trips t where t.id = invitation.trip_id for update;

  select * into membership
  from public.trip_members m
  where m.trip_id = invitation.trip_id and m.user_id = caller
  for update;

  if found and membership.left_at is null then
    -- Unticked on the joining screen by someone already in: honoured, since
    -- it keeps their address to themselves. Ticked changes nothing.
    if not coalesce(join_trip.calendar_attendee, true) then
      insert into public.calendar_opt_outs (trip_id, user_id)
      values (invitation.trip_id, caller)
      on conflict do nothing;
    end if;
    return query select invitation.trip_id, false;
    return;
  end if;

  if invitation.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = 'P0001';
  end if;
  if invitation.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = 'P0001';
  end if;

  if membership.user_id is not null then
    -- Someone who left or was removed comes back only with a link issued
    -- after they went; otherwise a removed member could walk straight back
    -- in with the link that let them in the first time.
    if invitation.created_at <= membership.left_at then
      raise exception 'invitation_predates_departure' using errcode = 'P0001';
    end if;

    update public.trip_members m
    set left_at = null, joined_at = now(), role = 'member'
    where m.trip_id = invitation.trip_id and m.user_id = caller;
  else
    insert into public.trip_members (trip_id, user_id, role)
    values (invitation.trip_id, caller, 'member');
  end if;

  if coalesce(join_trip.calendar_attendee, true) then
    delete from public.calendar_opt_outs o
    where o.trip_id = invitation.trip_id and o.user_id = caller;
  else
    insert into public.calendar_opt_outs (trip_id, user_id)
    values (invitation.trip_id, caller)
    on conflict do nothing;
  end if;

  return query select invitation.trip_id, true;
end;
$$;

-- RLS -------------------------------------------------------------------------------
-- Each member's setting is theirs alone: nobody else in the trip reads it or
-- changes it. Setting it takes being a current member of the trip.

alter table public.calendar_opt_outs enable row level security;

create policy calendar_opt_outs_select on public.calendar_opt_outs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy calendar_opt_outs_insert on public.calendar_opt_outs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and trip_id in (select private.my_trip_ids())
  );

create policy calendar_opt_outs_delete on public.calendar_opt_outs
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and trip_id in (select private.my_trip_ids())
  );

-- Grants ----------------------------------------------------------------------------

revoke all on public.calendar_opt_outs from anon, authenticated, service_role;
grant select, delete on public.calendar_opt_outs to authenticated;
grant insert (trip_id, user_id) on public.calendar_opt_outs to authenticated;
grant select, insert, delete on public.calendar_opt_outs to service_role;

revoke all on function public.join_trip(text, boolean) from public, anon, authenticated;
grant execute on function public.join_trip(text, boolean) to authenticated;
