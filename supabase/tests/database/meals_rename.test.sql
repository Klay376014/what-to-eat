-- Renaming a meal: a current member edits an "other" meal's label, and
-- nothing else about any meal.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   departed member of trip A
--   erin   signed in, in no trip
begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

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

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'other', 'Afternoon tea'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-05', 'other', 'Airport last meal');

-- A member renames an "other" meal -------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ update public.meals set label = 'Matcha and cake'
     where id = 'a0000000-0000-0000-0000-000000000001'
     returning label $$,
  array['Matcha and cake'],
  'a member renames an "other" meal and reads the new name back'
);

-- Renaming keeps the meal where it was.
select results_eq(
  $$ select date, slot::text from public.meals
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('2026-10-02'::date, 'other'::text) $$,
  'the renamed meal keeps its day and slot'
);

-- The label rules still hold on update ---------------------------------------

select throws_ok(
  $$ update public.meals set label = '   '
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a blank name is refused'
);
select throws_ok(
  $$ update public.meals set label = repeat('x', 61)
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a name longer than 60 characters is refused'
);
select throws_ok(
  $$ update public.meals set label = ' Tea '
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a padded name is refused: a label is stored trimmed on update too'
);
select throws_ok(
  $$ update public.meals set label = null
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'an "other" meal cannot lose its name'
);
select throws_ok(
  $$ update public.meals set label = 'Late dinner'
     where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'breakfast, lunch and dinner cannot be given a name'
);

-- Only the name is editable --------------------------------------------------

select throws_ok(
  $$ update public.meals set date = '2026-10-03'
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot move a meal to another day'
);
select throws_ok(
  $$ update public.meals set slot = 'lunch', label = null
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot turn a meal into another slot'
);
select throws_ok(
  $$ update public.meals set trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot move a meal to another trip'
);
select throws_ok(
  $$ update public.meals set id = gen_random_uuid()
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot rewrite a meal id'
);
select throws_ok(
  $$ update public.meals set created_at = now()
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot rewrite when a meal was added'
);

reset role;

select ok(
  has_column_privilege('authenticated', 'public.meals', 'label', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.meals', 'id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.meals', 'trip_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.meals', 'date', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.meals', 'slot', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.meals', 'position', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.meals', 'created_at', 'UPDATE'),
  'authenticated may update a meal''s label and no other column'
);
select ok(
  not has_column_privilege('anon', 'public.meals', 'label', 'UPDATE'),
  'anon may not update a meal''s label'
);

-- A meal stranded by a date change can still be renamed ----------------------
-- The range rule applies when a meal's day is written, not to its name.

update public.trips set start_date = '2026-10-01', end_date = '2026-10-03'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ update public.meals set label = 'Airport ramen'
     where id = 'a0000000-0000-0000-0000-000000000003'
     returning label $$,
  array['Airport ramen'],
  'a meal now outside the trip''s dates can still be renamed'
);

-- The organiser renames like any member.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ update public.meals set label = 'Tea at Higashiya'
     where id = 'a0000000-0000-0000-0000-000000000001'
     returning label $$,
  array['Tea at Higashiya'],
  'the organiser renames a meal a member added'
);

-- A departed member and a stranger rename nothing, and learn nothing ---------
-- A refused rename matches no row and raises nothing, whatever the name: were
-- the label rules checked first, a stranger could tell a meal exists by the
-- error an invalid name gets.

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ update public.meals set label = 'Hijacked'
     where id = 'a0000000-0000-0000-0000-000000000001'
     returning id $$,
  'a departed member cannot rename a meal'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ update public.meals set label = 'Hijacked'
     where id = 'a0000000-0000-0000-0000-000000000001'
     returning id $$,
  'a non-member cannot rename a meal'
);
select is_empty(
  $$ update public.meals set label = repeat('x', 61)
     where id = 'a0000000-0000-0000-0000-000000000001'
     returning id $$,
  'a non-member''s invalid name for an existing meal raises nothing either'
);
select is_empty(
  $$ update public.meals set label = 'Late dinner'
     where id = 'a0000000-0000-0000-0000-000000000002'
     returning id $$,
  'a non-member naming a fixed-slot meal raises nothing either'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ update public.meals set label = 'Hijacked'
     where id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'an unauthenticated caller cannot rename a meal'
);

-- The refused renames left the names as the members set them ----------------

reset role;

select results_eq(
  $$ select label from public.meals
     where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     order by position $$,
  array['Tea at Higashiya', null, 'Airport ramen'],
  'every refused rename left the meals'' names intact'
);

select * from finish();
rollback;
