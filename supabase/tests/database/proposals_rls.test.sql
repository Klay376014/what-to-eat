-- Who can read and add a meal's proposals, and that nobody can delete one.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
--   dave   departed member of trip A, who proposed before leaving
--   carol  organiser of trip B
--   erin   signed in, in no trip
--
-- Identities are simulated the way PostgREST does it; see trips_rls.test.sql.
begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

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
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch', null),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-21', 'lunch', null);

insert into public.proposals (id, meal_id, proposed_by, place_name, created_at) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Dave''s izakaya', now() - interval '36 hours'),
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri Ramen Ebisu', now() - interval '1 hour'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tosokchon', now() - interval '1 hour');

-- A member reads and adds their trip's proposals -------------------------------
-- The positive control: without it, every denial below would also pass
-- against a policy that refuses everyone.

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select id from public.proposals order by created_at $$,
  array[
    'd0000000-0000-0000-0000-000000000001'::uuid,
    'a1000000-0000-0000-0000-000000000001'::uuid
  ],
  'a member reads their trip''s proposals, a departed member''s included, and no other trip''s'
);
select results_eq(
  $$ select proposed_by from public.proposals
     where id = 'd0000000-0000-0000-0000-000000000001' $$,
  array['44444444-4444-4444-4444-444444444444'::uuid],
  'a departed member''s proposal still says who proposed it'
);
select results_eq(
  $$ insert into public.proposals (meal_id, place_name, source_url, note)
     values ('a0000000-0000-0000-0000-000000000001', 'Ichiran Shibuya',
             'https://maps.app.goo.gl/AbCdEf123', 'Open late')
     returning place_name, proposed_by $$,
  $$ values ('Ichiran Shibuya'::text, '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'a member proposes a restaurant for their trip''s meal and reads it back as theirs'
);
select results_eq(
  $$ select count(*)::int from public.proposals
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  array[3],
  'the meal now has three proposals'
);

-- The organiser proposes like any member.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000002', 'Tsuta') $$,
  'the organiser proposes for another of the trip''s meals'
);

-- Nobody proposes on someone else's behalf ------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, proposed_by)
     values ('a0000000-0000-0000-0000-000000000001', 'In Alice''s name',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'a member cannot propose in another member''s name'
);

-- A departed member loses access ------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ select id from public.proposals $$,
  'a departed member no longer reads the trip''s proposals, not even their own'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', 'One more') $$,
  '42501', null,
  'a departed member cannot propose'
);

-- A signed-in stranger sees and adds nothing, and learns nothing ---------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ select id from public.proposals $$,
  'a non-member reads no proposal'
);
select is_empty(
  $$ select id from public.proposals
     where id = 'a1000000-0000-0000-0000-000000000001' $$,
  'a non-member cannot read a proposal even by its id'
);
select is_empty(
  $$ select id from public.proposals
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  'a non-member cannot read a meal''s proposals by the meal''s id'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', 'Gatecrasher') $$,
  '42501', null,
  'a non-member cannot propose for a trip''s meal'
);
-- The refusal must not depend on the meal or the values: were a CHECK or the
-- foreign key reported first, a stranger could tell which meal ids exist.
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', '   ') $$,
  '42501', null,
  'a non-member''s invalid name for a real meal is refused as a non-member, revealing nothing'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-00000000ffff', 'Nowhere') $$,
  '42501', null,
  'proposing for a meal that does not exist is refused the same way'
);
select throws_ok(
  $$ update public.proposals set name_locked_at = now()
     where id = 'a1000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a non-member cannot write the name lock'
);

-- A member of one trip cannot reach another ------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select results_eq(
  $$ select id from public.proposals $$,
  array['b1000000-0000-0000-0000-000000000001'::uuid],
  'a member of trip B reads trip B''s proposals only'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', 'From Seoul') $$,
  '42501', null,
  'the organiser of trip B cannot propose for trip A''s meal'
);

-- An unauthenticated caller can do nothing --------------------------------------

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select * from public.proposals $$,
  '42501', null,
  'an unauthenticated caller cannot read proposals'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', 'Anonymous') $$,
  '42501', null,
  'an unauthenticated caller cannot propose'
);

-- Nobody deletes a proposal --------------------------------------------------------
-- The record of what was considered is what makes a past decision legible.

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ delete from public.proposals
     where meal_id = 'a0000000-0000-0000-0000-000000000001'
       and proposed_by = '22222222-2222-2222-2222-222222222222' $$,
  '42501', null,
  'the proposer cannot delete their own proposal'
);
select throws_ok(
  $$ delete from public.proposals
     where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a member cannot delete a departed member''s proposal'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ delete from public.proposals
     where id = 'a1000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the organiser cannot delete their own proposal'
);
select throws_ok(
  $$ delete from public.proposals
     where meal_id = 'a0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the organiser cannot delete a member''s proposal'
);
select throws_ok(
  $$ truncate public.proposals $$,
  '42501', null,
  'the organiser cannot truncate proposals'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select throws_ok(
  $$ delete from public.proposals $$,
  '42501', null,
  'a non-member cannot delete proposals'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ delete from public.proposals $$,
  '42501', null,
  'an unauthenticated caller cannot delete proposals'
);

-- Not even the service role, which bypasses RLS, deletes one.
reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select throws_ok(
  $$ delete from public.proposals
     where id = 'a1000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the service role cannot delete a proposal'
);
select throws_ok(
  $$ truncate public.proposals $$,
  '42501', null,
  'the service role cannot truncate proposals'
);

reset role;

-- Every denied write left the proposals as they were ------------------------------
-- Matching no rows is not proof on its own; check as the owner.

select results_eq(
  $$ select place_name from public.proposals order by created_at, place_name $$,
  array['Dave''s izakaya', 'Afuri Ramen Ebisu', 'Tosokchon', 'Ichiran Shibuya', 'Tsuta'],
  'every refused write and delete left the proposals intact'
);

-- The stranger's empty view above is not an artefact of missing rows.
select results_eq(
  $$ select count(*)::int from public.proposals $$,
  array[5],
  'the owner sees every trip''s proposals'
);

-- A proposal outlives its proposer's account ---------------------------------------
-- Deleting an account (a privacy request) forgets who proposed, not what was
-- proposed: a decision may rest on it.

delete from auth.users where id = '44444444-4444-4444-4444-444444444444';

select results_eq(
  $$ select place_name, proposed_by from public.proposals
     where id = 'd0000000-0000-0000-0000-000000000001' $$,
  $$ values ('Dave''s izakaya'::text, null::uuid) $$,
  'a deleted account''s proposal stays, no longer attributed'
);

-- Privileges, stated rather than inferred --------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.proposals', 'DELETE')
    and not has_table_privilege('authenticated', 'public.proposals', 'TRUNCATE')
    and not has_table_privilege('anon', 'public.proposals', 'DELETE')
    and not has_table_privilege('anon', 'public.proposals', 'TRUNCATE')
    and not has_table_privilege('service_role', 'public.proposals', 'DELETE')
    and not has_table_privilege('service_role', 'public.proposals', 'TRUNCATE'),
  'no client role, nor the service role, holds DELETE or TRUNCATE on proposals'
);
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public' and tablename = 'proposals' and cmd in ('DELETE', 'ALL') $$,
  'no policy on proposals permits a delete'
);
select ok(
  has_column_privilege('authenticated', 'public.proposals', 'meal_id', 'INSERT')
    and has_column_privilege('authenticated', 'public.proposals', 'place_name', 'INSERT')
    and has_column_privilege('authenticated', 'public.proposals', 'source_url', 'INSERT')
    and has_column_privilege('authenticated', 'public.proposals', 'note', 'INSERT')
    and not has_column_privilege('authenticated', 'public.proposals', 'id', 'INSERT')
    and not has_column_privilege('authenticated', 'public.proposals', 'proposed_by', 'INSERT')
    and not has_column_privilege('authenticated', 'public.proposals', 'created_at', 'INSERT')
    and not has_column_privilege('authenticated', 'public.proposals', 'name_locked_at', 'INSERT'),
  'authenticated proposes with a meal, a name, a link and a note, and nothing else'
);
select ok(
  not has_table_privilege('anon', 'public.proposals', 'SELECT')
    and not has_table_privilege('anon', 'public.proposals', 'INSERT')
    and not has_table_privilege('anon', 'public.proposals', 'UPDATE'),
  'anon holds no privilege on proposals'
);

select * from finish();
rollback;
