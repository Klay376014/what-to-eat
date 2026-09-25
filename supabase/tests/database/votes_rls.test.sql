-- Who can read and cast votes: every current member reads every vote in the
-- trip, a departed member's included; a member casts, changes and withdraws
-- only their own; a departed member keeps their vote but can no longer touch
-- it; nobody else sees or casts anything.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A, who proposed Afuri and voted -1 on it
--   bob    member of trip A
--   dave   departed member of trip A, who voted +1 on Afuri before leaving
--   carol  organiser of trip B, who voted +1 on her own proposal
--   erin   signed in, in no trip
--
-- Identities are simulated the way PostgREST does it; see trips_rls.test.sql.
begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

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
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-12-21', 'lunch', null);

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tsuta'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Tosokchon');

insert into public.votes (proposal_id, voter_id, value, created_at) values
  ('a1000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 1, now() - interval '36 hours'),
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', -1, now() - interval '1 hour'),
  ('b1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 1, now() - interval '1 hour');

-- A member reads every vote in the trip and casts their own -----------------------
-- The positive control: without it, every denial below would also pass
-- against a policy that refuses everyone.

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select voter_id, value from public.votes order by created_at $$,
  $$ values ('44444444-4444-4444-4444-444444444444'::uuid, 1::smallint),
            ('11111111-1111-1111-1111-111111111111'::uuid, -1::smallint) $$,
  'a member reads who voted which way in their trip, a departed member''s vote included, and no other trip''s'
);
select lives_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000001', 1) $$,
  'a member votes +1'
);
select results_eq(
  $$ update public.votes set value = -1
     where proposal_id = 'a1000000-0000-0000-0000-000000000001'
       and voter_id = '22222222-2222-2222-2222-222222222222'
     returning value $$,
  array[-1::smallint],
  'a member changes their vote'
);
select results_eq(
  $$ delete from public.votes
     where proposal_id = 'a1000000-0000-0000-0000-000000000001'
       and voter_id = '22222222-2222-2222-2222-222222222222'
     returning value $$,
  array[-1::smallint],
  'a member withdraws their vote'
);
select lives_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000002', 1::smallint) $$,
  'a member votes through cast_vote'
);
select results_eq(
  $$ select voter_id from public.votes
     where proposal_id = 'a1000000-0000-0000-0000-000000000002' $$,
  array['22222222-2222-2222-2222-222222222222'::uuid],
  'the vote cast through cast_vote is theirs'
);

-- Nobody votes on someone else's behalf, or touches their vote -----------------------

select throws_ok(
  $$ insert into public.votes (proposal_id, voter_id, value)
     values ('a1000000-0000-0000-0000-000000000002',
             '11111111-1111-1111-1111-111111111111', -1) $$,
  '42501', null,
  'a member cannot vote in another member''s name'
);
select throws_ok(
  $$ update public.votes set voter_id = '11111111-1111-1111-1111-111111111111'
     where proposal_id = 'a1000000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'a member cannot hand their vote to another member'
);
select is_empty(
  $$ update public.votes set value = 1
     where voter_id = '11111111-1111-1111-1111-111111111111'
     returning 1 $$,
  'a member cannot change another member''s vote'
);
select is_empty(
  $$ delete from public.votes
     where voter_id = '11111111-1111-1111-1111-111111111111'
     returning 1 $$,
  'a member cannot withdraw another member''s vote'
);
select is_empty(
  $$ delete from public.votes
     where voter_id = '44444444-4444-4444-4444-444444444444'
     returning 1 $$,
  'a member cannot withdraw a departed member''s vote'
);

-- Not even the organiser.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is_empty(
  $$ update public.votes set value = -1
     where voter_id = '22222222-2222-2222-2222-222222222222'
     returning 1 $$,
  'the organiser cannot change a member''s vote'
);
select is_empty(
  $$ delete from public.votes
     where voter_id in ('22222222-2222-2222-2222-222222222222',
                        '44444444-4444-4444-4444-444444444444')
     returning 1 $$,
  'the organiser cannot withdraw anyone else''s vote'
);

reset role;

select results_eq(
  $$ select voter_id, value from public.votes
     where proposal_id::text like 'a%' order by created_at $$,
  $$ values ('44444444-4444-4444-4444-444444444444'::uuid, 1::smallint),
            ('11111111-1111-1111-1111-111111111111'::uuid, -1::smallint),
            ('22222222-2222-2222-2222-222222222222'::uuid, 1::smallint) $$,
  'every refused change left the votes as they were'
);

-- A departed member's vote stays, out of their reach -------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ select 1 from public.votes $$,
  'a departed member no longer reads the trip''s votes, not even their own'
);
select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000002', 1) $$,
  '42501', null,
  'a departed member cannot vote'
);
select throws_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000002', 1::smallint) $$,
  '42501', null,
  'a departed member cannot vote through cast_vote'
);
select is_empty(
  $$ update public.votes set value = -1
     where voter_id = '44444444-4444-4444-4444-444444444444'
     returning 1 $$,
  'a departed member cannot change the vote they left behind'
);
select is_empty(
  $$ delete from public.votes
     where voter_id = '44444444-4444-4444-4444-444444444444'
     returning 1 $$,
  'a departed member cannot withdraw the vote they left behind'
);

reset role;

select results_eq(
  $$ select value from public.votes
     where voter_id = '44444444-4444-4444-4444-444444444444' $$,
  array[1::smallint],
  'the departed member''s vote still counts, as it was'
);

-- A signed-in stranger sees and casts nothing, and learns nothing -----------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ select 1 from public.votes $$,
  'a non-member reads no vote'
);
select is_empty(
  $$ select 1 from public.votes
     where proposal_id = 'a1000000-0000-0000-0000-000000000001' $$,
  'a non-member cannot read a proposal''s votes by its id'
);
select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000001', 1) $$,
  '42501', null,
  'a non-member cannot vote'
);
select throws_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000001', 1::smallint) $$,
  '42501', null,
  'a non-member cannot vote through cast_vote'
);
-- The refusal must not depend on the proposal or the value: were the foreign
-- key or the CHECK reported first, a stranger could tell which ids exist.
select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-00000000ffff', 1) $$,
  '42501', null,
  'voting on an invented proposal is refused the same way'
);
select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000001', 0) $$,
  '42501', null,
  'an invalid value from a non-member is refused the same way'
);
select is_empty(
  $$ update public.votes set value = -1 returning 1 $$,
  'a non-member changes no vote'
);
select is_empty(
  $$ delete from public.votes returning 1 $$,
  'a non-member withdraws no vote'
);

-- Another trip's organiser sees only her own trip -----------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

select results_eq(
  $$ select proposal_id from public.votes $$,
  array['b1000000-0000-0000-0000-000000000001'::uuid],
  'a member of another trip reads only their own trip''s votes'
);
select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000002', 1) $$,
  '42501', null,
  'a member of another trip cannot vote on this trip''s proposals'
);

-- Signed out, and the server's own key -------------------------------------------

reset role;
set local role anon;

select throws_ok(
  $$ select 1 from public.votes $$,
  '42501', null,
  'a signed-out visitor cannot read votes at all'
);
select throws_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000001', 1::smallint) $$,
  '42501', null,
  'a signed-out visitor cannot call cast_vote'
);

-- service_role reads votes (the nudge and digest of #15 and #16 need to) and
-- writes none: every vote is cast by the member it belongs to.
reset role;
set local role service_role;

select results_eq(
  $$ select count(*)::int from public.votes $$,
  array[4],
  'service_role reads every vote'
);
select throws_ok(
  $$ insert into public.votes (proposal_id, voter_id, value)
     values ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1) $$,
  '42501', null,
  'service_role cannot cast a vote for anyone'
);

select * from finish();
rollback;
