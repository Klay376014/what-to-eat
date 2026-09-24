-- Profiles: the human name and picture behind a user id.
--
-- trip_members carries only user ids, and `authenticated` cannot read
-- auth.users, so without this table the app cannot show who organises a trip,
-- who proposed a restaurant or who voted. docs/privacy.md promises that your
-- name and profile picture are shown to the other members of your trips, and
-- to nobody else; the policy below is that promise.
--
-- A profile is copied from the Google sign-in metadata by a trigger on
-- auth.users, so it exists from the moment the user does and follows their
-- Google name and picture on every later sign-in. There is no client write:
-- the profile is Google's identity, not something edited in the app.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Null when Google sent no name; the app shows a neutral placeholder.
  display_name text check (char_length(display_name) between 1 and 200),
  -- Only https URLs are kept, so a crafted metadata value cannot become a
  -- javascript: or data: URL rendered in someone else's browser.
  avatar_url text check (avatar_url ~ '^https://' and char_length(avatar_url) <= 2000),
  updated_at timestamptz not null default now()
);

-- Copying the sign-in metadata -----------------------------------------------
-- Google's userinfo gives `name` and `picture`; Supabase Auth also mirrors
-- them as `full_name` and `avatar_url`. Either spelling is accepted. Values
-- that would violate the checks above are dropped rather than failing the
-- sign-in: a missing name is better than a user who cannot sign up.
--
-- SECURITY DEFINER because the role running the auth.users write
-- (supabase_auth_admin) has no privilege on public.profiles.
create function private.sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  display text := left(
    nullif(btrim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), ''),
    200
  );
  avatar text := coalesce(meta ->> 'avatar_url', meta ->> 'picture');
begin
  if avatar !~ '^https://' or char_length(avatar) > 2000 then
    avatar := null;
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, display, avatar)
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();

  return new;
end;
$$;

create trigger on_auth_user_profile
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function private.sync_profile();

-- Users who signed up before this migration get their profile now.
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  left(nullif(btrim(coalesce(
    u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''
  )), ''), 200),
  case
    when coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') ~ '^https://'
      and char_length(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')) <= 2000
    then coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  end
from auth.users u
on conflict (id) do nothing;

-- Who may read a profile ---------------------------------------------------
-- Everyone who is or was in a trip the caller currently belongs to, departed
-- members included, so "proposed by" and "decided by" still resolve after
-- someone leaves. Same shape and reasoning as the helpers in the initial
-- migration: set-returning, SECURITY DEFINER so the read of trip_members does
-- not go through its policy, empty search_path, and answering only about
-- auth.uid().
create function private.my_co_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.user_id
  from public.trip_members m
  where m.trip_id in (
    select mine.trip_id
    from public.trip_members mine
    where mine.user_id = (select auth.uid())
      and mine.left_at is null
  )
$$;

alter table public.profiles enable row level security;

-- Your own profile, whether or not you are in any trip, and the profiles of
-- the people you share a trip with. A stranger's profile is invisible.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select private.my_co_member_ids())
  );

-- Grants ------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

revoke all on function private.sync_profile() from public, anon, authenticated, service_role;
revoke all on function private.my_co_member_ids() from public, anon, authenticated, service_role;
grant execute on function private.my_co_member_ids() to authenticated;
