-- The rules a trip's meals obey, whoever writes them: at most one breakfast,
-- lunch and dinner per day, any number of "other" meals in a stable order,
-- each "other" with its own label, and a dated trip's meals on its days.
--
-- Writes run as a member (bob), the way the app makes them, so a rule the
-- table owner could slip past would still show up here.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A (dated, 1-5 Oct) and of trip E (undated)
--   bob    member of trip A and of trip E
begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

-- The table and its shape -----------------------------------------------------

select has_table('public', 'meals', 'meals exists');
select enum_has_labels(
  'public', 'meal_slot', array['breakfast', 'lunch', 'dinner', 'other'],
  'a meal is a breakfast, lunch, dinner or "other"'
);
select col_not_null('public', 'meals', 'trip_id', 'a meal belongs to a trip');
select col_not_null('public', 'meals', 'date', 'every meal has a real date, undated trips included');
select col_not_null('public', 'meals', 'slot', 'every meal has a slot');
select col_not_null('public', 'meals', 'position', 'every meal has a place in its day''s order');

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Everyday', null, null, 'Asia/Taipei');

insert into public.trip_members (trip_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'organiser'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '22222222-2222-2222-2222-222222222222', 'member');

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- Breakfast, lunch and dinner: at most one of each per day ------------------

select lives_ok(
  $$ insert into public.meals (trip_id, date, slot) values
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'breakfast'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'dinner') $$,
  'a member adds breakfast, lunch and dinner to an empty day'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch') $$,
  '23505', null,
  'a second lunch on one day is refused'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'breakfast') $$,
  '23505', null,
  'a second breakfast on one day is refused'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'dinner') $$,
  '23505', null,
  'a second dinner on one day is refused'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot) values
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'dinner'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'dinner') $$,
  '23505', null,
  'two dinners for the same day in one statement are refused'
);
select lives_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'lunch') $$,
  'the next day has its own lunch'
);
select lives_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-10-03', 'lunch') $$,
  'another trip has its own lunch on the same date'
);

reset role;
select results_eq(
  $$ select slot::text from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and date = '2026-10-03'
     order by position $$,
  array['breakfast', 'lunch', 'dinner'],
  'the refused meals left one breakfast, lunch and dinner on the day'
);
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- "Other" repeats freely, each with its own label, in a stable order -------

select lives_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'other', 'Afternoon tea') $$,
  'an "other" meal joins a day that already has breakfast, lunch and dinner'
);
select lives_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'other', 'Late-night snack') $$,
  'a second "other" meal on the same day is permitted'
);
select lives_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'other', 'Afternoon tea') $$,
  'even an "other" meal with the same label as another is permitted'
);
select results_eq(
  $$ select label from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and date = '2026-10-03' and slot = 'other'
     order by position $$,
  array['Afternoon tea', 'Late-night snack', 'Afternoon tea'],
  'a day''s "other" meals keep the order they were added in'
);

select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'other') $$,
  '23514', null,
  'an "other" meal needs a label'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-05', 'lunch', 'Brunch') $$,
  '23514', null,
  'breakfast, lunch and dinner are named by their slot, not a label'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'other', '   ') $$,
  '23514', null,
  'a blank label is refused'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'other', ' Tea ') $$,
  '23514', null,
  'a label is stored trimmed, so padding cannot slip past the length limit'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'other', repeat('x', 61)) $$,
  '23514', null,
  'a label longer than 60 characters is refused'
);

-- The order is the database's to give, not the client's (GENERATED ALWAYS
-- refuses the value before the missing column grant is even consulted).
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label, position)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-04', 'other', 'Cuts in', -1) $$,
  '428C9', null,
  'a member cannot choose where a meal sits in the order'
);

-- A dated trip's meals fall on its days --------------------------------------

select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-09-30', 'dinner') $$,
  '23514', null,
  'a meal the day before a dated trip starts is refused'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot, label)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-06', 'other', 'Airport') $$,
  '23514', null,
  'a meal the day after a dated trip ends is refused'
);
select lives_ok(
  $$ insert into public.meals (trip_id, date, slot) values
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-01', 'dinner'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-05', 'breakfast') $$,
  'meals on a dated trip''s first and last days are accepted'
);

-- An undated trip is for everyday use: any real date will do.
select lives_ok(
  $$ insert into public.meals (trip_id, date, slot) values
       ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2025-01-01', 'dinner'),
       ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2027-12-31', 'dinner') $$,
  'an undated trip takes meals on any date'
);
select throws_ok(
  $$ insert into public.meals (trip_id, slot)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'dinner') $$,
  '23502', null,
  'even on an undated trip, a meal without a date is refused'
);

-- Changing the dates warns rather than deletes (#5) --------------------------
-- The range rule applies when a meal is written. A later change to the trip's
-- dates keeps every meal, including those now outside the range: the app
-- warns the organiser and lists them instead.

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ update public.trips set start_date = '2026-10-04', end_date = '2026-10-08'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'the organiser moves the trip past days that have meals'
);
select results_eq(
  $$ select count(*)::int from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and date < '2026-10-04' $$,
  array[7],
  'the meals now before the trip are kept, not deleted'
);
select throws_ok(
  $$ insert into public.meals (trip_id, date, slot)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'dinner') $$,
  '23514', null,
  'a new meal is held to the new range'
);

select lives_ok(
  $$ update public.trips set start_date = null, end_date = null
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'the organiser clears the trip''s dates'
);
select results_eq(
  $$ select count(*)::int from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  array[9],
  'clearing the dates keeps every meal, each still on its own date'
);

-- Deleting a trip takes its meals with it ------------------------------------

select lives_ok(
  $$ delete from public.trips where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' $$,
  'the organiser deletes a trip that has meals'
);
reset role;
select is_empty(
  $$ select id from public.meals
     where trip_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' $$,
  'the deleted trip''s meals are gone'
);

select * from finish();
rollback;
