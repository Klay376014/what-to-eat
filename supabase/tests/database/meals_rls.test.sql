-- Who can read and add a trip's meals.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   departed member of trip A
--   carol  organiser of trip B
--   erin   signed in, in no trip
--
-- Identities are simulated the way PostgREST does it; see trips_rls.test.sql.
begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '2 days', null);

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'other', 'Afternoon tea'),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-21', 'lunch', null);

-- A member reads and adds their trip's meals ---------------------------------
-- The positive control: without it, every denial below would also pass
-- against a policy that refuses everyone.

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select id from public.meals order by position $$,
  array[
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'a0000000-0000-0000-0000-000000000002'::uuid
  ],
  'a member reads their trip''s meals, and no other trip''s'
);
select results_eq(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch')
     returning slot::text $$,
  array['lunch'],
  'a member adds a meal to their trip and reads it back'
);

-- The organiser is a member like any other here.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ select count(*)::int from public.meals $$,
  array[3],
  'the organiser reads every meal in their trip, including one a member added'
);

-- Nobody moves or deletes a meal through the API ----------------------------
-- Moving and removing meals are not part of the grid; a meal's proposals and
-- decision (later tickets) hang off it. Renaming: meals_rename.test.sql.

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ update public.meals set date = '2026-10-04'
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot move a meal'
);
select throws_ok(
  $$ delete from public.meals
     where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'a member cannot delete a meal'
);

-- A departed member loses access ---------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ select id from public.meals $$,
  'a departed member no longer reads the trip''s meals'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'dinner') $$,
  '42501', null,
  'a departed member cannot add a meal'
);

-- A signed-in stranger sees and adds nothing ---------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ select id from public.meals $$,
  'a non-member reads no meal'
);
select is_empty(
  $$ select id from public.meals
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  'a non-member cannot read a meal even by its id'
);
select is_empty(
  $$ select id from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a non-member cannot read a trip''s meals by the trip''s id'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'breakfast') $$,
  '42501', null,
  'a non-member cannot add a meal to a trip'
);
-- The refusal must not depend on what the trip holds: were the uniqueness or
-- date rule reported first, a stranger could learn which slots a trip has
-- filled, or its dates, from the error code.
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner') $$,
  '42501', null,
  'a non-member adding a taken slot is refused as a non-member, revealing nothing'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2030-01-01', 'dinner') $$,
  '42501', null,
  'a non-member adding outside the trip''s dates is refused as a non-member, revealing nothing'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-10-04', 'dinner') $$,
  '42501', null,
  'adding to a trip that does not exist is refused the same way'
);

-- A member of one trip cannot reach another ----------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select results_eq(
  $$ select id from public.meals $$,
  array['b0000000-0000-0000-0000-000000000001'::uuid],
  'a member of trip B reads trip B''s meals'
);
select is_empty(
  $$ select id from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a member of trip B cannot read trip A''s meals'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'other', 'Snack') $$,
  '42501', null,
  'the organiser of trip B cannot add a meal to trip A'
);

-- An unauthenticated caller can do nothing -----------------------------------

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select * from public.meals $$,
  '42501', null,
  'an unauthenticated caller cannot read meals'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'dinner') $$,
  '42501', null,
  'an unauthenticated caller cannot add a meal'
);

-- Every denied write left trip A's meals as they were ------------------------
-- Matching no rows is not proof on its own; check as the owner.

reset role;

select results_eq(
  $$ select date, slot::text, label from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     order by position $$,
  $$ values
       ('2026-10-02'::date, 'dinner'::text, null::text),
       ('2026-10-02'::date, 'other'::text, 'Afternoon tea'::text),
       ('2026-10-03'::date, 'lunch'::text, null::text) $$,
  'the refused writes changed none of trip A''s meals'
);
select is_empty(
  $$ select id from public.meals
     where trip_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'no meal was created for a trip that does not exist'
);

-- The stranger's empty view above is not an artefact of missing rows.

select results_eq(
  $$ select count(*)::int from public.meals $$,
  array[4],
  'the owner sees every trip''s meals'
);

-- The date rule's trigger function is not callable by anyone ----------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ select private.check_meal_date() $$,
  '42501', null,
  'a member cannot call the date rule''s trigger function'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select private.check_meal_date() $$,
  '42501', null,
  'an unauthenticated caller cannot call the date rule''s trigger function'
);

reset role;

-- Privileges, stated rather than inferred ----------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.meals', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.meals', 'DELETE')
    and not has_table_privilege('authenticated', 'public.meals', 'TRUNCATE'),
  'authenticated holds no table-wide UPDATE (only the label, see meals_rename), DELETE or TRUNCATE on meals'
);
select ok(
  not has_table_privilege('anon', 'public.meals', 'SELECT')
    and not has_table_privilege('anon', 'public.meals', 'INSERT'),
  'anon holds no privilege on meals'
);

select * from finish();
rollback;
