-- Editing a proposal: its proposer changes its name and note, nobody else
-- changes anything, and once anyone has voted the name is read-only for
-- everyone while the note stays editable.
--
-- Votes arrive in #10. The lock is the proposal's `name_locked_at`, which only
-- private.lock_proposal_name() sets; #10's vote trigger calls it (see
-- docs/adr/0005-proposal-name-lock.md). Here the owner calls it, standing in
-- for the first vote.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A, who proposed Afuri
--   frank  member of trip A
--   dave   departed member of trip A, who proposed before leaving
--   erin   signed in, in no trip
begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'erin@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'frank@example.com');

insert into public.trips (id, name, start_date, end_date, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tokyo', '2026-10-01', '2026-10-05', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', now() - interval '2 days', null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'member', now() - interval '2 days', now() - interval '1 day'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', 'member', now() - interval '2 days', null);

insert into public.meals (id, trip_id, date, slot, label) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-02', 'dinner', null),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-03', 'lunch', null);

insert into public.proposals (id, meal_id, proposed_by, place_name, source_url, note) values
  ('b2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Afuri', 'https://maps.app.goo.gl/AbCdEf123', null),
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   'Dave''s izakaya', null, 'Cheap');

-- The proposer edits the name and note of their own proposal --------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ update public.proposals set place_name = 'Afuri Ramen Ebisu', note = 'Yuzu shio is the one'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning place_name, note $$,
  $$ values ('Afuri Ramen Ebisu'::text, 'Yuzu shio is the one'::text) $$,
  'the proposer corrects the name and adds a note'
);
select results_eq(
  $$ update public.proposals set note = null
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning note $$,
  array[null::text],
  'the proposer clears their note'
);

-- The value rules still hold on update.
select throws_ok(
  $$ update public.proposals set place_name = '  '
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a blank name is refused on edit'
);
select throws_ok(
  $$ update public.proposals set place_name = null
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '23502', null,
  'a proposal cannot lose its name'
);
select throws_ok(
  $$ update public.proposals set note = repeat('x', 1001)
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'an over-long note is refused on edit'
);

-- Only the name and note are editable ---------------------------------------------
-- The link, coordinates and CID pin down which restaurant it is, so changing
-- them would swap the restaurant as surely as a new name.

select throws_ok(
  $$ update public.proposals set source_url = 'https://maps.app.goo.gl/Other'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the proposer cannot change the link'
);
select throws_ok(
  $$ update public.proposals set lat = 1, lng = 1
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the proposer cannot change the coordinates'
);
select throws_ok(
  $$ update public.proposals set place_cid = '1'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the proposer cannot change the CID'
);
select throws_ok(
  $$ update public.proposals set meal_id = 'a0000000-0000-0000-0000-000000000002'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the proposer cannot move their proposal to another meal'
);
select throws_ok(
  $$ update public.proposals set proposed_by = '66666666-6666-6666-6666-666666666666'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the proposer cannot hand their proposal to someone else'
);
select throws_ok(
  $$ update public.proposals set created_at = now() - interval '1 year'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the proposer cannot rewrite when it was proposed'
);
select throws_ok(
  $$ update public.proposals set name_locked_at = null
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'the proposer cannot write the name lock'
);

-- Nobody else edits it, and nobody else learns anything by trying --------------------
-- A refused edit matches no row and raises nothing, whatever the values: were
-- a CHECK or the name lock reported first, it would tell the caller something.

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select is_empty(
  $$ update public.proposals set place_name = 'Swapped'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'another member cannot rename someone else''s proposal'
);
select is_empty(
  $$ update public.proposals set note = 'Terrible, skip it'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'another member cannot change someone else''s note'
);
select is_empty(
  $$ update public.proposals set place_name = '  '
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'another member''s invalid name raises nothing either'
);
select is_empty(
  $$ update public.proposals set note = 'Mine now'
     where id = 'd0000000-0000-0000-0000-000000000001'
     returning id $$,
  'a member cannot edit a departed member''s proposal'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is_empty(
  $$ update public.proposals set place_name = 'Organiser''s pick', note = 'Overruled'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'the organiser cannot edit a member''s proposal'
);

-- A departed proposer no longer edits their own.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}';

select is_empty(
  $$ update public.proposals set note = 'Changed my mind'
     where id = 'd0000000-0000-0000-0000-000000000001'
     returning id $$,
  'a departed member cannot edit the proposal they made before leaving'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ update public.proposals set place_name = 'Hijacked'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'a non-member cannot edit a proposal'
);
select is_empty(
  $$ update public.proposals set place_name = repeat('x', 201)
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'a non-member''s invalid name for an existing proposal raises nothing either'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ update public.proposals set place_name = 'Hijacked'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'an unauthenticated caller cannot edit a proposal'
);

reset role;

select results_eq(
  $$ select place_name, note from public.proposals order by place_name $$,
  $$ values ('Afuri Ramen Ebisu'::text, null::text), ('Dave''s izakaya'::text, 'Cheap'::text) $$,
  'every refused edit left the proposals as their proposers wrote them'
);

-- The first vote locks the name ---------------------------------------------------------
-- Standing in for #10's first vote on bob's proposal.

select lives_ok(
  $$ select private.lock_proposal_name('b2000000-0000-0000-0000-000000000001') $$,
  'the first vote locks the proposal''s name'
);
select isnt(
  (select name_locked_at from public.proposals where id = 'b2000000-0000-0000-0000-000000000001'),
  null,
  'the proposal says its name is locked'
);
select is(
  (select name_locked_at from public.proposals where id = 'd0000000-0000-0000-0000-000000000001'),
  null,
  'a proposal nobody voted on stays unlocked'
);

-- A later vote leaves the lock as it was.
select lives_ok(
  $$ select private.lock_proposal_name('b2000000-0000-0000-0000-000000000001') $$,
  'a second vote on the same proposal is no error'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ select name_locked_at is not null from public.proposals
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  array[true],
  'members can read that the name is locked, so the app can say why'
);
select throws_ok(
  $$ update public.proposals set place_name = 'Somewhere else entirely'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  'P0001', 'proposal_name_locked',
  'once voted on, the proposer cannot change the name'
);
select throws_ok(
  $$ update public.proposals set place_name = 'Afuri Ramen Ebisu (Ebisu)', note = 'Sneaky'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  'P0001', 'proposal_name_locked',
  'a name change bundled with a note change is refused whole'
);
select results_eq(
  $$ update public.proposals set note = 'Queue moves fast'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning note $$,
  array['Queue moves fast'],
  'the note stays editable after the name locks'
);
select results_eq(
  $$ update public.proposals set place_name = 'Afuri Ramen Ebisu', note = 'Queue moves fast, cash only'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning note $$,
  array['Queue moves fast, cash only'],
  'sending the unchanged name along with a new note is no error'
);

-- The lock holds for everyone, the table owner included ------------------------------

reset role;

select throws_ok(
  $$ update public.proposals set place_name = 'Owner''s rename'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  'P0001', 'proposal_name_locked',
  'even the table owner cannot change a locked name'
);
select throws_ok(
  $$ update public.proposals set name_locked_at = null
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  'P0001', 'proposal_name_unlock',
  'even the table owner cannot unlock a name'
);

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select throws_ok(
  $$ update public.proposals set place_name = 'Service rename'
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  'P0001', 'proposal_name_locked',
  'the service role cannot change a locked name'
);

reset role;

select results_eq(
  $$ select place_name, note from public.proposals
     where id = 'b2000000-0000-0000-0000-000000000001' $$,
  $$ values ('Afuri Ramen Ebisu'::text, 'Queue moves fast, cash only'::text) $$,
  'the locked proposal kept the name people voted on'
);

-- A stranger learns nothing about the lock --------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

select is_empty(
  $$ update public.proposals set place_name = 'Probe'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'a non-member renaming a locked proposal gets no rows, not the lock''s error'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}';

select is_empty(
  $$ update public.proposals set place_name = 'Probe'
     where id = 'b2000000-0000-0000-0000-000000000001'
     returning id $$,
  'another member renaming a locked proposal gets no rows either'
);

-- Only the vote path can lock ----------------------------------------------------------

select throws_ok(
  $$ select private.lock_proposal_name('d0000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a member cannot lock a proposal''s name by calling the lock directly'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select private.lock_proposal_name('d0000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'an unauthenticated caller cannot lock a proposal''s name'
);

reset role;

select ok(
  has_column_privilege('authenticated', 'public.proposals', 'place_name', 'UPDATE')
    and has_column_privilege('authenticated', 'public.proposals', 'note', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'meal_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'proposed_by', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'source_url', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'place_cid', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'lat', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'lng', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'name_locked_at', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposals', 'created_at', 'UPDATE'),
  'authenticated may update a proposal''s name and note and no other column'
);
select ok(
  not has_function_privilege('authenticated', 'private.lock_proposal_name(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'private.lock_proposal_name(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'private.lock_proposal_name(uuid)', 'EXECUTE'),
  'no client role can call the lock'
);

select * from finish();
rollback;
