-- The rules a proposal obeys, whoever writes it: it names a restaurant, may
-- carry a Maps link and a note, and has room for the coordinates and CID that
-- #9 resolves from the link, none of which is required.
--
-- Writes run as a member (bob), the way the app makes them, so a rule the
-- table owner could slip past would still show up here.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

-- The table and its shape -----------------------------------------------------

select has_table('public', 'proposals', 'proposals exists');
select col_not_null('public', 'proposals', 'meal_id', 'a proposal belongs to a meal');
select col_not_null('public', 'proposals', 'place_name', 'a proposal names a restaurant');
select col_not_null('public', 'proposals', 'created_at', 'a proposal records when it was made');
select col_is_null('public', 'proposals', 'source_url', 'the Maps link is optional');
select col_is_null('public', 'proposals', 'note', 'the note is optional');
select col_is_null('public', 'proposals', 'place_cid', 'the CID (#9) is optional');
select col_is_null('public', 'proposals', 'lat', 'the latitude (#9) is optional');
select col_is_null('public', 'proposals', 'lng', 'the longitude (#9) is optional');
select col_is_null('public', 'proposals', 'name_locked_at', 'a new proposal''s name is not locked');
select hasnt_column('public', 'proposals', 'place_id', 'there is no Places place_id: short links do not yield one');

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

set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- A name alone is a proposal ----------------------------------------------------

select results_eq(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', 'Afuri Ramen Ebisu')
     returning place_name, source_url, note, proposed_by $$,
  $$ values ('Afuri Ramen Ebisu'::text, null::text, null::text,
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'a typed name with no link and no note is a proposal, recorded as the caller''s'
);

-- The link is stored as given ---------------------------------------------------

select results_eq(
  $$ insert into public.proposals (meal_id, place_name, source_url, note)
     values ('a0000000-0000-0000-0000-000000000001', 'Ichiran Shibuya',
             'https://maps.app.goo.gl/AbCdEf123?g_st=ic', 'No reservation needed')
     returning source_url, note $$,
  $$ values ('https://maps.app.goo.gl/AbCdEf123?g_st=ic'::text, 'No reservation needed'::text) $$,
  'a Maps link and a note are stored exactly as given'
);
select lives_ok(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'Tsuta',
             'https://www.google.co.jp/maps/place/Tsuta/@35.7,139.7,17z') $$,
  'a long-form Maps link on a non-.com host is accepted too'
);
select lives_ok(
  $$ insert into public.proposals (meal_id, place_name, note)
     values ('a0000000-0000-0000-0000-000000000001', 'Fuunji',
             E'20 min walk from the hotel.\nCash only.') $$,
  'a note may run over several lines'
);

-- The name ------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.proposals (meal_id) values ('a0000000-0000-0000-0000-000000000001') $$,
  '23502', null,
  'a proposal without a name is refused'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', '   ') $$,
  '23514', null,
  'a blank name is refused'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', ' Afuri ') $$,
  '23514', null,
  'a name is stored trimmed, so padding cannot slip past the length limit'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', repeat('x', 201)) $$,
  '23514', null,
  'a name longer than 200 characters is refused'
);
select lives_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', repeat('x', 200)) $$,
  'a name of exactly 200 characters is accepted'
);

-- The link ------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'Afuri', 'javascript:alert(1)') $$,
  '23514', null,
  'a link that is not http(s) is refused'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'Afuri', '') $$,
  '23514', null,
  'an empty link is refused: no link is null'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'Afuri',
             'https://maps.app.goo.gl/' || repeat('x', 2000)) $$,
  '23514', null,
  'a link longer than 2000 characters is refused'
);

-- The note ------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, note)
     values ('a0000000-0000-0000-0000-000000000001', 'Afuri', '  ') $$,
  '23514', null,
  'a blank note is refused: no note is null'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, note)
     values ('a0000000-0000-0000-0000-000000000001', 'Afuri', repeat('x', 1001)) $$,
  '23514', null,
  'a note longer than 1000 characters is refused'
);

-- The database fills in who and when ----------------------------------------------

select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, created_at)
     values ('a0000000-0000-0000-0000-000000000001', 'Backdated', now() - interval '1 year') $$,
  '42501', null,
  'a member cannot choose when their proposal was made'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, name_locked_at)
     values ('a0000000-0000-0000-0000-000000000001', 'Pre-locked', now()) $$,
  '42501', null,
  'a member cannot write the name lock'
);

-- Room for #9: coordinates and CID ------------------------------------------------
-- Checked as the owner: which path writes them is #9's to choose, so no client
-- grant exists yet. Their value rules hold whoever writes.

reset role;

select lives_ok(
  $$ insert into public.proposals (meal_id, proposed_by, place_name, source_url, place_cid, lat, lng)
     values ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
             'Afuri Ramen Ebisu', 'https://maps.app.goo.gl/AbCdEf123',
             '12345678901234567890', 35.6467, 139.7101) $$,
  'a proposal can carry a CID and coordinates alongside the original link'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, lat)
     values ('a0000000-0000-0000-0000-000000000001', 'Half a place', 35.6) $$,
  '23514', null,
  'a latitude without a longitude is refused'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, lat, lng)
     values ('a0000000-0000-0000-0000-000000000001', 'Off the map', 91, 0) $$,
  '23514', null,
  'a latitude past the pole is refused'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, lat, lng)
     values ('a0000000-0000-0000-0000-000000000001', 'Off the map', 0, 181) $$,
  '23514', null,
  'a longitude past the antimeridian is refused'
);

-- A proposal belongs to a real meal ------------------------------------------------

select throws_ok(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-00000000ffff', 'Nowhere') $$,
  '23503', null,
  'even the owner cannot propose for a meal that does not exist'
);

-- Deleting a trip takes its meals' proposals with it --------------------------------
-- The one way a proposal ever goes: the whole trip is deleted by its organiser.

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select lives_ok(
  $$ delete from public.trips where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'the organiser deletes a trip whose meals have proposals'
);

reset role;

select is_empty(
  $$ select id from public.proposals $$,
  'the deleted trip''s proposals are gone with it'
);

select * from finish();
rollback;
