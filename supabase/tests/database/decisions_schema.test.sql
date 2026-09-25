-- The rules a decision obeys, whoever makes it: one per meal, always one of
-- that meal's own proposals, recorded as the caller's with the time, and a
-- decided restaurant keeps its name.
--
-- Writes run as a member (bob), the way the app makes them, so a rule the
-- table owner could slip past would still show up here.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A, who proposed Afuri and Tsuta for dinner
--   bob    member of trip A, who proposed Ichiran for lunch
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- The table and its shape -----------------------------------------------------

select has_table('public', 'decisions', 'decisions exists');
select col_is_pk('public', 'decisions', 'meal_id', 'a meal holds at most one decision');
select col_not_null('public', 'decisions', 'proposal_id', 'a decision names a proposal');
select col_not_null('public', 'decisions', 'decided_at', 'a decision records when it was made');
select col_is_null('public', 'decisions', 'decided_by',
  'who decided may be unknown, once their account is deleted');
select fk_ok(
  'public', 'decisions', array['proposal_id', 'meal_id'],
  'public', 'proposals', array['id', 'meal_id'],
  'the decided proposal and the meal are one foreign key, so the proposal is always the meal''s own'
);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member');

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch', null);

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tsuta'),
  ('b2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Ichiran');

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- Deciding ----------------------------------------------------------------------

select results_eq(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001')
     returning proposal_id, decided_by $$,
  $$ values ('a1000000-0000-0000-0000-000000000001'::uuid,
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'a member decides a meal with one of its proposals, recorded as theirs'
);

-- One decision per meal -----------------------------------------------------------

select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002') $$,
  '23505', null,
  'a second decision for the same meal is refused'
);

-- The proposal is always the meal's own --------------------------------------------

select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001') $$,
  '23503', null,
  'deciding lunch with a proposal made for dinner is refused by the foreign key'
);
select throws_ok(
  $$ update public.decisions set proposal_id = 'b2000000-0000-0000-0000-000000000001'
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '23503', null,
  'changing dinner''s decision to a proposal made for lunch is refused too'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-00000000ffff') $$,
  '23503', null,
  'deciding with a proposal that does not exist is refused'
);
select throws_ok(
  $$ update public.decisions set meal_id = 'a0000000-0000-0000-0000-000000000002'
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a decision cannot be moved to another meal'
);

-- The database fills in who and when ----------------------------------------------

select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id, decided_by)
     values ('a0000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'a member cannot decide in someone else''s name'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id, decided_at)
     values ('a0000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001',
             now() - interval '1 year') $$,
  '42501', null,
  'a member cannot choose when their decision was made'
);
select throws_ok(
  $$ update public.decisions set decided_by = '11111111-1111-1111-1111-111111111111'
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot hand a decision to someone else'
);

-- Changing a decision makes it the changer's, as of now ----------------------------

reset role;
update public.decisions set decided_at = now() - interval '1 day'
where meal_id = 'a0000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000002'
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning proposal_id, decided_by, decided_at = now() $$,
  $$ values ('a1000000-0000-0000-0000-000000000002'::uuid,
             '11111111-1111-1111-1111-111111111111'::uuid, true) $$,
  'the organiser changes the decision, and it is now the organiser''s, made now'
);

-- A decided restaurant keeps its name -----------------------------------------------
-- Otherwise its proposer could turn the decided noodle shop into somewhere
-- nobody chose, the same swap the vote lock prevents (ADR 0005).

select throws_ok(
  $$ update public.proposals set place_name = 'Somewhere else'
     where id = 'a1000000-0000-0000-0000-000000000002' $$,
  'P0001', 'proposal_decided',
  'the proposer cannot rename the decided restaurant, though nobody voted on it'
);
select lives_ok(
  $$ update public.proposals set note = 'Book ahead'
     where id = 'a1000000-0000-0000-0000-000000000002' $$,
  'the proposer can still change its note'
);
select lives_ok(
  $$ update public.proposals set place_name = 'Afuri Ramen Ebisu'
     where id = 'a1000000-0000-0000-0000-000000000001' $$,
  'a proposal of the same meal that was not chosen can still be renamed'
);
select lives_ok(
  $$ update public.proposals set place_name = 'Tsuta', note = null
     where id = 'a1000000-0000-0000-0000-000000000002' $$,
  'sending the unchanged name with a new note is not a rename'
);

reset role;

select throws_ok(
  $$ update public.proposals set place_name = 'Somewhere else'
     where id = 'a1000000-0000-0000-0000-000000000002' $$,
  'P0001', 'proposal_decided',
  'not even the table owner renames a decided restaurant'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ delete from public.decisions where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'the organiser clears the decision'
);
select lives_ok(
  $$ update public.proposals set place_name = 'Tsuta Sugamo'
     where id = 'a1000000-0000-0000-0000-000000000002' $$,
  'once it is no longer decided, its proposer can rename it again'
);

-- A decision outlives its decider's account ------------------------------------------

reset role;

insert into public.decisions (meal_id, proposal_id, decided_by) values
  ('a0000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ delete from auth.users where id = '22222222-2222-2222-2222-222222222222' $$,
  'an account that decided a meal can be deleted'
);
select results_eq(
  $$ select proposal_id, decided_by from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000002' $$,
  $$ values ('b2000000-0000-0000-0000-000000000001'::uuid, null::uuid) $$,
  'the decision stays, without the decider''s name'
);

-- Deleting a trip takes its decisions with it ------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ delete from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'the organiser deletes a trip with a decided meal'
);

reset role;

select is_empty(
  $$ select 1 from public.decisions $$,
  'the deleted trip''s decisions are gone with it'
);

select * from finish();
rollback;
