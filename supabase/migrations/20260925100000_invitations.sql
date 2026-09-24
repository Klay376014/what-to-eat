-- Invitations and membership management (#6).
--
-- An organiser issues a link, pastes it into the group chat, and whoever
-- opens it joins the trip. A link rather than named email invitations,
-- because the organiser rarely knows which of a friend's Google accounts they
-- will use. The cost is that anyone holding the link can join, so a link
-- expires 7 days after it is issued and can be revoked.
--
-- Every change to membership goes through a SECURITY DEFINER function below;
-- authenticated still holds only SELECT on trip_members and invitations. The
-- functions answer only about auth.uid(), refuse with 42501 when the caller
-- lacks the role, and otherwise refuse with P0001 and a fixed, machine-
-- readable message ('invitation_expired', 'trip_full', ...) that the app
-- turns into an explanation. None of those messages names the trip.

-- Supabase installs pgcrypto in `extensions`; this is a no-op there and keeps
-- a bare Postgres honest.
create extension if not exists pgcrypto with schema extensions;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  -- 256 random bits as unpadded base64url. The format check means no path,
  -- the owner's included, can store a short or hand-picked token.
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  -- Who issued it. Kept when they later hand over the role; cleared if their
  -- account is deleted, since the link belongs to the trip, not to them.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  -- No invitation, however it is written, outlives 7 days.
  check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  check (revoked_at is null or revoked_at >= created_at)
);

create index invitations_trip_id_idx on public.invitations (trip_id);

-- Helpers -------------------------------------------------------------------
-- Private, like the membership predicates in the initial migration: not in
-- [api].schemas, EXECUTE revoked from every client role.

-- The most current members a trip may have. A product decision (#1): past
-- eight, voting on each proposal stops being coordination and becomes a
-- survey nobody fills in.
create function private.trip_member_limit()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 8
$$;

create function private.new_invitation_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(
    rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='),
    '+/', '-_'
  )
$$;

-- The member limit ---------------------------------------------------------
-- A trigger rather than a check inside join_trip(), so the limit holds on
-- every path that adds a member or brings a departed one back, the table
-- owner's included.
--
-- Two people opening the link at the same moment would each count seven and
-- both get in, so the trigger first locks the trip's row. The second waits
-- for the first to commit, and its count (a new statement, so a new snapshot
-- under READ COMMITTED) then sees the eighth member. Every membership
-- function takes the same lock first, so the lock order is always the trip,
-- then membership rows.
create function private.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.left_at is null and (tg_op = 'INSERT' or old.left_at is not null) then
    perform 1 from public.trips t where t.id = new.trip_id for update;

    if (
      select count(*) from public.trip_members m
      where m.trip_id = new.trip_id
        and m.left_at is null
        and m.user_id <> new.user_id
    ) >= private.trip_member_limit() then
      raise exception 'trip_full'
        using errcode = 'P0001',
          hint = 'A trip has at most 8 current members.';
    end if;
  end if;

  return new;
end;
$$;

create trigger trip_members_limit
  before insert or update of left_at on public.trip_members
  for each row execute function private.enforce_member_limit();

-- Never a trip without an organiser ------------------------------------------
-- trip_members.user_id cascades from auth.users, so deleting the organiser's
-- account (say, for a deletion request under the privacy policy) deletes
-- their membership row. With no organiser, nobody could ever edit, invite to
-- or delete the trip again. So when an organiser's row is deleted, the
-- longest-standing current member takes over.
--
-- AFTER DELETE, because the partial unique index allows only one organiser
-- and the old row must be gone first. When the whole trip is being deleted
-- its row is already gone by the time its memberships cascade, and there is
-- nobody to promote.
--
-- This is the only way a membership row is ever deleted: authenticated has
-- no DELETE on trip_members, and leaving or removal set left_at instead, so
-- a departed member's proposals and votes keep pointing at a row that
-- exists. An account deletion is the exception by design: the person asked
-- for their data to go.
create function private.keep_an_organiser()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'organiser'
    and exists (select 1 from public.trips t where t.id = old.trip_id)
  then
    update public.trip_members m
    set role = 'organiser'
    where m.trip_id = old.trip_id
      and m.user_id = (
        select c.user_id from public.trip_members c
        where c.trip_id = old.trip_id and c.left_at is null
        order by c.joined_at, c.user_id
        limit 1
      );
  end if;

  return null;
end;
$$;

create trigger trip_members_keep_an_organiser
  after delete on public.trip_members
  for each row execute function private.keep_an_organiser();

-- Issuing and revoking links ------------------------------------------------

create function public.create_invitation(trip_id uuid)
returns public.invitations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  invitation public.invitations;
begin
  perform 1 from public.trips t where t.id = create_invitation.trip_id for update;

  if caller is null
    or not coalesce(
      create_invitation.trip_id in (select private.my_organiser_trip_ids()),
      false
    )
  then
    raise exception 'only the organiser can invite people to this trip'
      using errcode = '42501';
  end if;

  -- Refused here as well as at joining, so the organiser learns the trip is
  -- full before sending a link that could never work.
  if (
    select count(*) from public.trip_members m
    where m.trip_id = create_invitation.trip_id and m.left_at is null
  ) >= private.trip_member_limit() then
    raise exception 'trip_full'
      using errcode = 'P0001',
        hint = 'A trip has at most 8 current members.';
  end if;

  insert into public.invitations (trip_id, token, created_by)
  values (create_invitation.trip_id, private.new_invitation_token(), caller)
  returning * into invitation;

  return invitation;
end;
$$;

-- A revoked link stops working at once. Revoking twice is not an error; a
-- revoked link cannot be revived.
create function public.revoke_invitation(invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.invitations i
    where i.id = revoke_invitation.invitation_id
      and i.trip_id in (select private.my_organiser_trip_ids())
  ) then
    raise exception 'only the organiser can revoke this invitation'
      using errcode = '42501';
  end if;

  update public.invitations i
  set revoked_at = now()
  where i.id = revoke_invitation.invitation_id
    and i.revoked_at is null;
end;
$$;

-- Opening a link ----------------------------------------------------------------
-- Returns the trip's id, and only once the caller is in it. Every refusal
-- happens before anything about the trip is looked at, and names only what
-- went wrong with the link. A member opening the link again is simply taken
-- in, even when the trip is full or the link has since stopped working for
-- others, so reopening an old message is never an error for them.
create function public.join_trip(token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    return invitation.trip_id;
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

  return invitation.trip_id;
end;
$$;

-- Removing, leaving and handing over --------------------------------------------
-- A departure sets left_at; the row stays (see the initial migration).

create function public.remove_member(trip_id uuid, user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1 from public.trips t where t.id = remove_member.trip_id for update;

  if not coalesce(
    remove_member.trip_id in (select private.my_organiser_trip_ids()),
    false
  ) then
    raise exception 'only the organiser can remove members' using errcode = '42501';
  end if;

  if remove_member.user_id = (select auth.uid()) then
    raise exception 'organiser_must_transfer' using errcode = 'P0001';
  end if;

  update public.trip_members m
  set left_at = now()
  where m.trip_id = remove_member.trip_id
    and m.user_id = remove_member.user_id
    and m.left_at is null;

  if not found then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;
end;
$$;

create function public.leave_trip(trip_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  membership public.trip_members;
begin
  perform 1 from public.trips t where t.id = leave_trip.trip_id for update;

  select * into membership
  from public.trip_members m
  where m.trip_id = leave_trip.trip_id
    and m.user_id = (select auth.uid())
    and m.left_at is null
  for update;

  if not found then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  -- The trip must never be left without an owner.
  if membership.role = 'organiser' then
    raise exception 'organiser_must_transfer' using errcode = 'P0001';
  end if;

  update public.trip_members m
  set left_at = now()
  where m.trip_id = leave_trip.trip_id and m.user_id = membership.user_id;
end;
$$;

create function public.transfer_organiser(trip_id uuid, user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  perform 1 from public.trips t where t.id = transfer_organiser.trip_id for update;

  if not coalesce(
    transfer_organiser.trip_id in (select private.my_organiser_trip_ids()),
    false
  ) then
    raise exception 'only the organiser can hand over the role' using errcode = '42501';
  end if;

  if transfer_organiser.user_id = caller then
    return;
  end if;

  if not exists (
    select 1 from public.trip_members m
    where m.trip_id = transfer_organiser.trip_id
      and m.user_id = transfer_organiser.user_id
      and m.left_at is null
  ) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  -- Demote first: the partial unique index allows one organiser at a time.
  update public.trip_members m
  set role = 'member'
  where m.trip_id = transfer_organiser.trip_id and m.user_id = caller;

  update public.trip_members m
  set role = 'organiser'
  where m.trip_id = transfer_organiser.trip_id
    and m.user_id = transfer_organiser.user_id;
end;
$$;

-- RLS ---------------------------------------------------------------------------

alter table public.invitations enable row level security;

-- Tokens are for the current organiser only. Members do not need them, and a
-- stranger holding a token must not be able to look up which trip it opens.
create policy invitations_select on public.invitations
  for select to authenticated
  using (trip_id in (select private.my_organiser_trip_ids()));

-- Grants --------------------------------------------------------------------------

revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;

revoke all on function private.trip_member_limit() from public, anon, authenticated, service_role;
revoke all on function private.new_invitation_token() from public, anon, authenticated, service_role;
revoke all on function private.enforce_member_limit() from public, anon, authenticated, service_role;
revoke all on function private.keep_an_organiser() from public, anon, authenticated, service_role;

revoke all on function public.create_invitation(uuid) from public, anon, authenticated;
revoke all on function public.revoke_invitation(uuid) from public, anon, authenticated;
revoke all on function public.join_trip(text) from public, anon, authenticated;
revoke all on function public.remove_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_trip(uuid) from public, anon, authenticated;
revoke all on function public.transfer_organiser(uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_invitation(uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.join_trip(text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_trip(uuid) to authenticated;
grant execute on function public.transfer_organiser(uuid, uuid) to authenticated;
