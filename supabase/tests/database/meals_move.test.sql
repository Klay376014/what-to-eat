-- Moving an "other" meal (#40): a current member moves it one stop up or
-- down its day, past breakfast, lunch and dinner (added or not) and past the
-- day's other "other" meals, through public.move_meal only.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   departed member of trip A
--   erin   signed in, in no trip
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day');

-- Day 2 has a lunch and two "other" meals; breakfast and dinner are not added.
insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'lunch', null),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'other', 'Tea'),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'other', 'Snack'),
  ('a0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'other', 'Airport');

-- Day 2's trail as the app lists it: breakfast, lunch and dinner at 1, 2 and
-- 3, and each "other" meal at its place. Read as the owner, past RLS.
create function pg_temp.trail() returns text[] language sql as $$
  select array_agg(name order by place) from (
    select 'Breakfast' as name, 1::numeric as place
    union all select 'Lunch', 2
    union all select 'Dinner', 3
    union all select m.label, m.place from public.meals m
      where m.trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and m.date = '2026-10-02' and m.slot = 'other'
  ) stops
$$;

-- Where meals are placed ---------------------------------------------------------

select is(pg_temp.trail(), array['Breakfast', 'Lunch', 'Dinner', 'Tea', 'Snack'],
  'a new "other" meal goes after dinner, after those added before it');
select is(
  (select count(*)::int from public.meals where slot <> 'other' and place is not null), 0,
  'breakfast, lunch and dinner carry no place of their own');
select throws_ok(
  $$ update public.meals set place = null where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'an "other" meal always has a place');

-- A member moves a meal ---------------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select id from public.move_meal('a0000000-0000-0000-0000-000000000003', 'up') order by id $$,
  $$ values ('a0000000-0000-0000-0000-000000000002'::uuid), ('a0000000-0000-0000-0000-000000000003'::uuid) $$,
  'moving past another "other" meal moves both, and says so');
reset role;
select is(pg_temp.trail(), array['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Tea'],
  'the two swap places');

set local role authenticated;
select lives_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000003', 'up') $$,
  'a member moves a meal up past a dinner nobody has added');
reset role;
select is(pg_temp.trail(), array['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Tea'],
  'it now sits between lunch and dinner');

set local role authenticated;
select results_eq(
  $$ select count(*)::int from public.move_meal('a0000000-0000-0000-0000-000000000003', 'up') $$,
  array[1],
  'moving past lunch moves only the meal');
select lives_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000003', 'up') $$,
  'and on past a breakfast nobody has added');
reset role;
select is(pg_temp.trail(), array['Snack', 'Breakfast', 'Lunch', 'Dinner', 'Tea'],
  'a meal can go before breakfast');

set local role authenticated;
select throws_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000003', 'up') $$,
  'P0001', 'meal_at_end',
  'nothing is before the start of the day');
select throws_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000002', 'down') $$,
  'P0001', 'meal_at_end',
  'nor after its end');

select lives_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000002', 'up') $$,
  'a meal moves up past dinner from the end of the day');
select lives_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000003', 'down') $$,
  'and another moves down past breakfast');
reset role;
select is(pg_temp.trail(), array['Breakfast', 'Snack', 'Lunch', 'Tea', 'Dinner'],
  'each lands right the other side of the meal it passed');

-- Moving changes nothing else about the meal.
select results_eq(
  $$ select date, slot::text, label, start_time from public.meals
     where id = 'a0000000-0000-0000-0000-000000000003' $$,
  $$ values ('2026-10-02'::date, 'other'::text, 'Snack'::text, null::time) $$,
  'a moved meal keeps its day, slot, name and time');

-- A meal added after all that still goes at the end.
insert into public.meals (trip_id, date, slot, label) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'other', 'Night market');
select is(pg_temp.trail(), array['Breakfast', 'Snack', 'Lunch', 'Tea', 'Dinner', 'Night market'],
  'a meal added later still goes at the end of the day');

-- The organiser moves like any member.
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
select lives_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000002', 'down') $$,
  'the organiser moves a meal a member added');

-- What cannot be moved -----------------------------------------------------------

select throws_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000001', 'up') $$,
  'P0001', 'meal_not_movable',
  'breakfast, lunch and dinner stay where they are');
select throws_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000002', 'sideways') $$,
  '22023', null,
  'a meal moves only up or down');

-- Only through move_meal ---------------------------------------------------------

select throws_ok(
  $$ update public.meals set place = 0 where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'a member cannot write a place directly');
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label, place)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'other', 'Tea', 0) $$,
  '42501', null,
  'nor pick a new meal''s place');

-- Who can move -------------------------------------------------------------------

set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';
select throws_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000004', 'up') $$,
  '42501', null,
  'a member who has left cannot move the trip''s meals');

set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';
select throws_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000004', 'up') $$,
  '42501', null,
  'nor can someone outside the trip');
select throws_ok(
  $$ select public.move_meal(gen_random_uuid(), 'up') $$,
  '42501', null,
  'a meal that does not exist is refused the same way');

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';
select throws_ok(
  $$ select public.move_meal('a0000000-0000-0000-0000-000000000004', 'up') $$,
  '42501', null,
  'signed out, nobody can move a meal');
reset role;

select is(
  (select place from public.meals where id = 'a0000000-0000-0000-0000-000000000004'),
  (select (3 + position)::numeric from public.meals where id = 'a0000000-0000-0000-0000-000000000004'),
  'the refused moves left the meal where it was');

select * from finish();
rollback;
