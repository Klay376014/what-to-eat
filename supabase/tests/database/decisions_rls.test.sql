-- Who can read and make decisions: every current member reads the trip's
-- decisions and decides an undecided meal; only the member who decided, or
-- the organiser, changes or clears one; nobody else sees or decides anything.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   frank  member of trip A
--   dave   departed member of trip A, who decided lunch before leaving
--   carol  organiser of trip B, who decided trip B's lunch
--   erin   signed in, in no trip
--
-- Identities are simulated the way PostgREST does it; see trips_rls.test.sql.
begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Seoul', '2026-12-20', '2026-12-24', 'Asia/Seoul');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', now() - interval '2 days', null);

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch', null),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-21', 'lunch', null);

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tsuta'),
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Ichiran'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tosokchon');

insert into public.decisions (meal_id, proposal_id, decided_by) values
  ('a0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444'),
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333');

-- Any member reads the trip's decisions and decides ------------------------------
-- The positive control: without it, every denial below would also pass
-- against a policy that refuses everyone.

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select meal_id, decided_by from public.decisions $$,
  $$ values ('a0000000-0000-0000-0000-000000000002'::uuid,
             '44444444-4444-4444-4444-444444444444'::uuid) $$,
  'a member reads their trip''s decisions, a departed member''s included, and no other trip''s'
);
select lives_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001') $$,
  'any member decides an undecided meal, not only the organiser'
);

-- Only the decider or the organiser changes or clears it ---------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select results_eq(
  $$ select decided_by from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  array['22222222-2222-2222-2222-222222222222'::uuid],
  'another member sees who decided dinner'
);
select is_empty(
  $$ update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000002'
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning 1 $$,
  'a member who did not decide cannot change the decision'
);
select is_empty(
  $$ delete from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning 1 $$,
  'a member who did not decide cannot clear the decision'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002') $$,
  '23505', null,
  'nor decide it over again'
);
select is_empty(
  $$ delete from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000002'
     returning 1 $$,
  'a member cannot clear a decision a departed member made'
);

reset role;

select results_eq(
  $$ select proposal_id, decided_by from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('a1000000-0000-0000-0000-000000000001'::uuid,
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'the refused change and clear left the decision as it was'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000002'
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning proposal_id $$,
  array['a1000000-0000-0000-0000-000000000002'::uuid],
  'the member who decided changes it to another of the meal''s proposals'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000002'
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning decided_by $$,
  array['22222222-2222-2222-2222-222222222222'::uuid],
  'the organiser re-sending the same proposal changes nothing, and it stays the member''s'
);
select results_eq(
  $$ update public.decisions set proposal_id = 'a1000000-0000-0000-0000-000000000001'
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning decided_by $$,
  array['11111111-1111-1111-1111-111111111111'::uuid],
  'the organiser changes a member''s decision, and it becomes the organiser''s'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is_empty(
  $$ delete from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning 1 $$,
  'once the organiser has changed it, the first decider can no longer clear it'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select results_eq(
  $$ delete from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning proposal_id $$,
  array['a1000000-0000-0000-0000-000000000001'::uuid],
  'the organiser clears a decision'
);
select results_eq(
  $$ delete from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000002'
     returning decided_by $$,
  array['44444444-4444-4444-4444-444444444444'::uuid],
  'the organiser clears a decision a departed member made'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002') $$,
  'with the meal undecided again, a member decides it'
);
select results_eq(
  $$ delete from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
     returning proposal_id $$,
  array['a1000000-0000-0000-0000-000000000002'::uuid],
  'and clears their own decision'
);

-- A departed member sees and decides nothing, not even their own ------------------

reset role;
insert into public.decisions (meal_id, proposal_id, decided_by) values
  ('a0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444');

set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ select 1 from public.decisions $$,
  'a departed member no longer reads the trip''s decisions'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a departed member cannot decide'
);
select is_empty(
  $$ update public.decisions set proposal_id = proposal_id returning 1 $$,
  'a departed member cannot change the decision they made'
);
select is_empty(
  $$ delete from public.decisions returning 1 $$,
  'a departed member cannot clear the decision they made'
);

-- A signed-in stranger sees and decides nothing, and learns nothing ---------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ select 1 from public.decisions $$,
  'a non-member reads no decision'
);
select is_empty(
  $$ select 1 from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000002' $$,
  'a non-member cannot read a meal''s decision by the meal''s id'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a non-member cannot decide a trip''s meal'
);
-- Were the foreign key or the uniqueness reported first, a stranger could
-- tell which meals exist and which are decided.
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-00000000ffff', 'a1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'deciding an invented meal is refused the same way'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id)
     values ('a0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'deciding an already decided meal is refused the same way'
);
select is_empty(
  $$ update public.decisions set proposal_id = proposal_id returning 1 $$,
  'a non-member changes no decision'
);
select is_empty(
  $$ delete from public.decisions returning 1 $$,
  'a non-member clears no decision'
);

-- Another trip's organiser is only the organiser of their own ----------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select results_eq(
  $$ select meal_id from public.decisions $$,
  array['b0000000-0000-0000-0000-000000000001'::uuid],
  'a member of another trip reads only their own trip''s decisions'
);
select is_empty(
  $$ delete from public.decisions
     where meal_id = 'a0000000-0000-0000-0000-000000000002'
     returning 1 $$,
  'another trip''s organiser cannot clear this trip''s decision'
);

-- Signed out, and the server's own key -------------------------------------------

reset role;
set local role anon;

select throws_ok(
  $$ select 1 from public.decisions $$,
  '42501', null,
  'a signed-out visitor cannot read decisions at all'
);

-- service_role reads decisions (the calendar and email of #12 onwards need
-- to) and makes none: a decision is always a member's.
reset role;
set local role service_role;

select results_eq(
  $$ select count(*)::int from public.decisions $$,
  array[2],
  'service_role reads every decision'
);
select throws_ok(
  $$ insert into public.decisions (meal_id, proposal_id, decided_by)
     values ('a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'service_role cannot decide a meal for anyone'
);

select * from finish();
rollback;
