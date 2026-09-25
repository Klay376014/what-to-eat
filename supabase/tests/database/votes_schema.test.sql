-- The rules a vote obeys, whoever casts it: +1 or -1 and nothing else, at
-- most one per member per proposal, cast in the caller's own name, and gone
-- with its trip or its voter's account.
--
-- Writes run as a member (bob), the way the app makes them, so a rule the
-- table owner could slip past would still show up here.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A, who proposed Afuri
--   bob    member of trip A
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- The table and its shape -----------------------------------------------------

select has_table('public', 'votes', 'votes exists');
select col_is_pk('public', 'votes', array['proposal_id', 'voter_id'],
  'a member has at most one vote per proposal');
select col_not_null('public', 'votes', 'value', 'a vote has a value');
select col_not_null('public', 'votes', 'created_at', 'a vote records when it was cast');
select hasnt_column('public', 'votes', 'id', 'a vote is its proposal and voter, nothing more');
select has_function('public', 'cast_vote', array['uuid', 'smallint'], 'cast_vote(proposal_id, value) exists');

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member');

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null);

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tsuta');

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- +1 and -1, and nothing else ---------------------------------------------------

select results_eq(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000001', 1)
     returning voter_id, value $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, 1::smallint) $$,
  'a +1 is a vote, recorded as the caller''s'
);
select lives_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000002', -1) $$,
  'a -1 is a vote'
);

delete from public.votes where proposal_id = 'a1000000-0000-0000-0000-000000000002';

select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000002', 0) $$,
  '23514', null,
  'a zero is refused: no vote is no opinion, so there is no abstain'
);
select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000002', 2) $$,
  '23514', null,
  'a +2 is refused'
);
select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000002', -2) $$,
  '23514', null,
  'a -2 is refused'
);
select throws_ok(
  $$ insert into public.votes (proposal_id) values ('a1000000-0000-0000-0000-000000000002') $$,
  '23502', null,
  'a vote without a value is refused'
);
select throws_ok(
  $$ update public.votes set value = 0
     where proposal_id = 'a1000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a vote cannot be changed to zero either'
);

-- One vote per member per proposal -----------------------------------------------

select throws_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000001', -1) $$,
  '23505', null,
  'a second vote on the same proposal is refused'
);

-- cast_vote casts or changes it in place -------------------------------------------

select lives_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000001', -1::smallint) $$,
  'cast_vote changes an existing vote'
);
select results_eq(
  $$ select value from public.votes
     where proposal_id = 'a1000000-0000-0000-0000-000000000001' $$,
  array[-1::smallint],
  'the vote is now -1, still one vote'
);
select lives_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000002', 1::smallint) $$,
  'cast_vote casts a first vote'
);
select results_eq(
  $$ select voter_id, value from public.votes
     where proposal_id = 'a1000000-0000-0000-0000-000000000002' $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, 1::smallint) $$,
  'cast_vote records the vote as the caller''s'
);
select throws_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000002', 0::smallint) $$,
  '23514', null,
  'cast_vote holds to the same values'
);

-- The database fills in who and when ----------------------------------------------

select throws_ok(
  $$ insert into public.votes (proposal_id, value, created_at)
     values ('a1000000-0000-0000-0000-000000000002', 1, now() - interval '1 year') $$,
  '42501', null,
  'a member cannot choose when their vote was cast'
);
select throws_ok(
  $$ update public.votes set proposal_id = 'a1000000-0000-0000-0000-000000000002'
     where proposal_id = 'a1000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'a vote cannot be moved to another proposal'
);

-- A vote belongs to a real proposal ------------------------------------------------

reset role;

select throws_ok(
  $$ insert into public.votes (proposal_id, voter_id, value)
     values ('a1000000-0000-0000-0000-00000000ffff', '22222222-2222-2222-2222-222222222222', 1) $$,
  '23503', null,
  'even the owner cannot vote on a proposal that does not exist'
);

-- Deleting an account takes its votes; deleting a trip takes everything -------------
-- Leaving a trip keeps a member's votes (votes_rls.test.sql). Deleting the
-- account is different: docs/privacy.md keeps only the restaurants proposed.

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'gone@example.com');
insert into public.trip_members (trip_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', 'member');
insert into public.votes (proposal_id, voter_id, value) values
  ('a1000000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', 1);

select lives_ok(
  $$ delete from auth.users where id = '77777777-7777-7777-7777-777777777777' $$,
  'an account with votes can be deleted'
);
select is_empty(
  $$ select 1 from public.votes where voter_id = '77777777-7777-7777-7777-777777777777' $$,
  'its votes are gone with it'
);
select results_eq(
  $$ select count(*)::int from public.votes $$,
  array[2],
  'everyone else''s votes stay'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ delete from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'the organiser deletes a trip whose proposals have votes'
);

reset role;

select is_empty(
  $$ select 1 from public.votes $$,
  'the deleted trip''s votes are gone with it'
);

select * from finish();
rollback;
