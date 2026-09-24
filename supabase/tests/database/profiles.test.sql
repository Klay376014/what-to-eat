-- Who can see whose name and picture.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   departed member of trip A
--   carol  organiser of trip B
--   erin   signed in, in no trip
--
-- Profiles are not inserted by the fixtures: each one appears because its
-- auth.users row did, the way a Google sign-up creates it.
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com',
   '{"full_name": "Alice Chen", "avatar_url": "https://lh3.googleusercontent.com/a/alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',
   '{"name": "Bob Lin", "picture": "https://lh3.googleusercontent.com/a/bob"}'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com',
   '{"full_name": "Carol Wu"}'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com',
   '{"full_name": "Dave Ho"}'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com',
   '{"full_name": "Erin Kao", "avatar_url": "javascript:alert(1)"}');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '2 days', null);

-- A profile is filled from the Google sign-in metadata -----------------------

select results_eq(
  $$ select display_name, avatar_url from public.profiles
     where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
     order by id $$,
  $$ values
       ('Alice Chen'::text, 'https://lh3.googleusercontent.com/a/alice'::text),
       ('Bob Lin'::text, 'https://lh3.googleusercontent.com/a/bob'::text) $$,
  'signing up creates a profile from either spelling of the Google name and picture'
);
select results_eq(
  $$ select display_name, avatar_url from public.profiles
     where id = '55555555-5555-5555-5555-555555555555' $$,
  $$ values ('Erin Kao'::text, null::text) $$,
  'a non-https picture is dropped rather than stored or failing the sign-up'
);

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'nameless@example.com');
select results_eq(
  $$ select display_name, avatar_url from public.profiles
     where id = '66666666-6666-6666-6666-666666666666' $$,
  $$ values (null::text, null::text) $$,
  'a user with no metadata still gets a profile'
);

update auth.users
set raw_user_meta_data = '{"full_name": "Alice Chen-Lee", "avatar_url": "https://lh3.googleusercontent.com/a/alice2"}'
where id = '11111111-1111-1111-1111-111111111111';
select results_eq(
  $$ select display_name, avatar_url from public.profiles
     where id = '11111111-1111-1111-1111-111111111111' $$,
  $$ values ('Alice Chen-Lee'::text, 'https://lh3.googleusercontent.com/a/alice2'::text) $$,
  'a later sign-in with a new Google name and picture updates the profile'
);

-- A member reads the profiles of everyone in their trip ----------------------
-- The positive control for the "cannot read" checks below.

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select display_name from public.profiles order by display_name $$,
  array['Alice Chen-Lee', 'Bob Lin', 'Dave Ho'],
  'a member reads the profiles of their trip, departed members included, and no one else'
);

-- A signed-in user in no trip sees only themselves ---------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select results_eq(
  $$ select display_name from public.profiles $$,
  array['Erin Kao'],
  'a user in no trip reads their own profile and nobody else''s'
);
select is_empty(
  $$ select id from public.profiles
     where id = '11111111-1111-1111-1111-111111111111' $$,
  'a stranger''s profile cannot be read even by its id'
);

-- A member of one trip cannot read the people of another ---------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select results_eq(
  $$ select display_name from public.profiles $$,
  array['Carol Wu'],
  'a member of trip B reads no profile from trip A'
);

-- A departed member no longer reads the trip's people ------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select results_eq(
  $$ select display_name from public.profiles $$,
  array['Dave Ho'],
  'a departed member reads only their own profile'
);

-- Nobody writes a profile from the client ------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ update public.profiles set display_name = 'Bobby'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null,
  'a user cannot rewrite even their own profile'
);
select throws_ok(
  $$ update public.profiles set display_name = 'Mallory'
     where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null,
  'a user cannot rewrite a co-member''s profile'
);
select throws_ok(
  $$ insert into public.profiles (id, display_name)
     values ('77777777-7777-7777-7777-777777777777', 'Ghost') $$,
  '42501', null,
  'a user cannot insert a profile'
);
select throws_ok(
  $$ delete from public.profiles where id = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null,
  'a user cannot delete a profile'
);

-- An unauthenticated caller reads nothing ------------------------------------

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select * from public.profiles $$,
  '42501', null,
  'anon cannot read profiles'
);

reset role;

select table_privs_are(
  'public', 'profiles', 'anon', array[]::text[],
  'anon holds no privilege on profiles'
);
select table_privs_are(
  'public', 'profiles', 'authenticated', array['SELECT'],
  'authenticated may only read profiles, subject to RLS'
);
select is_definer(
  'private', 'my_co_member_ids', array[]::text[],
  'my_co_member_ids() is security definer'
);

select * from finish();

rollback;
