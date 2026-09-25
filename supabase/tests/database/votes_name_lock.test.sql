-- Votes drive the proposal name lock (docs/adr/0005-proposal-name-lock.md):
-- the first vote locks the name, withdrawing the last one unlocks it, and
-- changing a vote does neither. proposals_edit.test.sql covers the lock and
-- unlock themselves; this is the path #10 owes, through real votes.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A, who proposed Afuri
--   bob    member of trip A
--   frank  member of trip A
begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member');

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null);

insert into public.proposals (id, meal_id, proposed_by, place_name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Afuri');

-- Whether Afuri's name is locked, as any member can read it.
create function pg_temp.afuri_locked() returns boolean language sql as $$
  select name_locked_at is not null from public.proposals
  where id = 'a1000000-0000-0000-0000-000000000001'
$$;
create function pg_temp.afuri_locked_at() returns timestamptz language sql as $$
  select name_locked_at from public.proposals
  where id = 'a1000000-0000-0000-0000-000000000001'
$$;
create function pg_temp.rename_afuri(name text) returns void language sql as $$
  update public.proposals set place_name = name
  where id = 'a1000000-0000-0000-0000-000000000001'
$$;
grant execute on function pg_temp.afuri_locked(), pg_temp.afuri_locked_at(), pg_temp.rename_afuri(text)
  to authenticated;

-- The first vote locks the name ------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select ok(not pg_temp.afuri_locked(), 'with no votes, the name is not locked');
select lives_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000001', 1) $$,
  'bob votes +1'
);
select ok(pg_temp.afuri_locked(), 'the first vote locks the name, though bob holds no grant on the lock');

create temporary table first_lock on commit drop as select pg_temp.afuri_locked_at() as at;
grant select on first_lock to authenticated;

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ select pg_temp.rename_afuri('Somewhere else') $$,
  'P0001', 'proposal_name_locked',
  'a member voted, so the proposer can no longer rename'
);
select lives_ok(
  $$ update public.proposals set note = 'Yuzu shio'
     where id = 'a1000000-0000-0000-0000-000000000001' $$,
  'the proposer can still change the note'
);

-- Changing a vote neither locks nor unlocks ------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select lives_ok(
  $$ update public.votes set value = -1
     where proposal_id = 'a1000000-0000-0000-0000-000000000001' $$,
  'bob changes his vote to -1'
);
select ok(pg_temp.afuri_locked(), 'changing a vote keeps the name locked');
select is(
  pg_temp.afuri_locked_at(), (select at from first_lock),
  'and keeps the time of the first lock'
);
select lives_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000001', 1::smallint) $$,
  'bob changes it back through cast_vote'
);
select is(
  pg_temp.afuri_locked_at(), (select at from first_lock),
  'changing a vote through cast_vote does not relock it either'
);

-- Withdrawing the last vote unlocks it -----------------------------------------------

select lives_ok(
  $$ delete from public.votes
     where proposal_id = 'a1000000-0000-0000-0000-000000000001' $$,
  'bob withdraws his vote'
);
select ok(not pg_temp.afuri_locked(), 'with the last vote withdrawn, the name is unlocked');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ select pg_temp.rename_afuri('Afuri Ramen Ebisu') $$,
  'the proposer can rename again'
);

-- While any vote remains, the name stays locked ---------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select lives_ok(
  $$ select public.cast_vote('a1000000-0000-0000-0000-000000000001', 1::smallint) $$,
  'bob votes through cast_vote'
);
select ok(pg_temp.afuri_locked(), 'a first vote through cast_vote locks the name too');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.votes (proposal_id, value)
     values ('a1000000-0000-0000-0000-000000000001', -1) $$,
  'frank votes -1'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select lives_ok(
  $$ delete from public.votes
     where proposal_id = 'a1000000-0000-0000-0000-000000000001'
       and voter_id = '22222222-2222-2222-2222-222222222222' $$,
  'bob withdraws his vote'
);
select ok(pg_temp.afuri_locked(), 'frank''s vote remains, so the name stays locked');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select throws_ok(
  $$ select pg_temp.rename_afuri('Somewhere else') $$,
  'P0001', 'proposal_name_locked',
  'the proposer still cannot rename'
);

-- A departed member's vote keeps it locked; deleting their account does not --------

reset role;

update public.trip_members set left_at = now()
where user_id = '66666666-6666-6666-6666-666666666666';

select ok(pg_temp.afuri_locked(), 'frank leaves the trip, and his vote still locks the name');

delete from auth.users where id = '66666666-6666-6666-6666-666666666666';

select ok(not pg_temp.afuri_locked(), 'deleting frank''s account takes his vote, the last one, and unlocks the name');

-- Every vote in one statement ---------------------------------------------------------
-- The unlock asks whether any vote remains once each row is gone, so a
-- statement that removes several still unlocks exactly once, at the end.

insert into public.votes (proposal_id, voter_id, value) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1),
  ('a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 1);

select ok(pg_temp.afuri_locked(), 'two votes in one statement lock the name');

delete from public.votes where proposal_id = 'a1000000-0000-0000-0000-000000000001';

select ok(not pg_temp.afuri_locked(), 'withdrawing both in one statement unlocks it');

select * from finish();
rollback;
