-- Resolved Maps short links (#9): the maps-link Edge Function keeps what each
-- short link resolved to, once and for good, and a proposal made with that
-- link takes its place (CID and coordinates) from there. No client reads or
-- writes the cache, and no client sends a proposal's place itself.
--
-- Cast (fixtures are inserted as the table owner, which bypasses RLS):
--   alice  organiser of trip A
--   bob    member of trip A
begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_table('public', 'maps_links', 'maps_links exists');
select col_is_pk('public', 'maps_links', 'source_url', 'one resolution per short link');

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

-- service_role, the maps-link Edge Function, keeps resolutions -----------------------

set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select lives_ok(
  $$ insert into public.maps_links (source_url, place_name, place_cid, lat, lng)
     values ('https://maps.app.goo.gl/2avW6UjkkDbgHUwPA', '美德耐 台科大活動中心第一餐廳',
             '11272421852253356408', 25.0140156, 121.542539) $$,
  'service_role keeps what a short link resolved to'
);
select lives_ok(
  $$ insert into public.maps_links (source_url)
     values ('https://maps.app.goo.gl/27Jewne9cvYxC4SW8') $$,
  'service_role keeps a link Google answered for without a place, so it is not asked again'
);
select results_eq(
  $$ select place_name, place_cid, lat, lng from public.maps_links
     where source_url = 'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA' $$,
  $$ values ('美德耐 台科大活動中心第一餐廳'::text, '11272421852253356408'::text,
             25.0140156::double precision, 121.542539::double precision) $$,
  'service_role reads a resolution back'
);
select throws_ok(
  $$ insert into public.maps_links (source_url)
     values ('https://maps.app.goo.gl/2avW6UjkkDbgHUwPA') $$,
  '23505', null,
  'a link is resolved once: a second resolution of it is refused'
);
select throws_ok(
  $$ update public.maps_links set place_name = 'Elsewhere'
     where source_url = 'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA' $$,
  '42501', null,
  'a resolution is kept for good: not even service_role changes it'
);
select throws_ok(
  $$ delete from public.maps_links $$,
  '42501', null,
  'nor removes it'
);

-- What a resolution may hold ------------------------------------------------------------

select throws_ok(
  $$ insert into public.maps_links (source_url, place_name)
     values ('https://maps.app.goo.gl/HalfResolved1', 'Afuri') $$,
  '23514', null,
  'a resolution is all of name, CID and coordinates, or none of them'
);
select throws_ok(
  $$ insert into public.maps_links (source_url)
     values ('https://example.com/2avW6UjkkDbgHUwPA') $$,
  '23514', null,
  'only Maps short links are kept'
);
select throws_ok(
  $$ insert into public.maps_links (source_url, place_name, place_cid, lat, lng)
     values ('https://maps.app.goo.gl/BadCid000001', 'Afuri', '0x9c6f', 25, 121) $$,
  '23514', null,
  'a CID is stored in decimal'
);
select throws_ok(
  $$ insert into public.maps_links (source_url, place_name, place_cid, lat, lng)
     values ('https://maps.app.goo.gl/BadLat000001', 'Afuri', '1', 91, 121) $$,
  '23514', null,
  'coordinates are on the globe'
);
select throws_ok(
  $$ insert into public.maps_links (source_url, place_name, place_cid, lat, lng)
     values ('https://maps.app.goo.gl/Blank0000001', '  ', '1', 25, 121) $$,
  '23514', null,
  'a blank name is not a resolution'
);

-- No client touches the cache --------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.maps_links $$,
  '42501', null,
  'a member cannot read the cache'
);
select throws_ok(
  $$ insert into public.maps_links (source_url, place_name, place_cid, lat, lng)
     values ('https://maps.app.goo.gl/Forged000001', 'Somewhere else', '1', 0, 0) $$,
  '42501', null,
  'a member cannot plant a resolution'
);
select throws_ok(
  $$ update public.maps_links set place_name = 'Elsewhere' $$,
  '42501', null,
  'a member cannot change one'
);
select throws_ok(
  $$ delete from public.maps_links $$,
  '42501', null,
  'a member cannot remove one'
);

reset role;
set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok(
  $$ select * from public.maps_links $$,
  '42501', null,
  'a visitor cannot read the cache'
);

-- A proposal takes its place from the cache ------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select results_eq(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'NTUST cafeteria',
             'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA')
     returning place_name, source_url, place_cid, lat, lng $$,
  $$ values ('NTUST cafeteria'::text, 'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA'::text,
             '11272421852253356408'::text,
             25.0140156::double precision, 121.542539::double precision) $$,
  'a proposal made with a resolved link stores its CID and coordinates beside the link, and keeps the name as typed'
);
select results_eq(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'Somewhere',
             'https://maps.app.goo.gl/27Jewne9cvYxC4SW8')
     returning place_cid, lat, lng $$,
  $$ values (null::text, null::double precision, null::double precision) $$,
  'a link that could not be resolved leaves the place empty, and the proposal is made'
);
select results_eq(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'Tsuta',
             'https://maps.app.goo.gl/NeverResolved')
     returning place_cid, lat, lng $$,
  $$ values (null::text, null::double precision, null::double precision) $$,
  'a link nobody resolved leaves the place empty, and the proposal is made'
);
select results_eq(
  $$ insert into public.proposals (meal_id, place_name)
     values ('a0000000-0000-0000-0000-000000000001', 'Fuunji')
     returning place_cid, lat, lng $$,
  $$ values (null::text, null::double precision, null::double precision) $$,
  'a proposal with no link has no place'
);
select results_eq(
  $$ insert into public.proposals (meal_id, place_name, source_url)
     values ('a0000000-0000-0000-0000-000000000001', 'NTUST again',
             'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA?g_st=ic')
     returning place_cid $$,
  $$ values (null::text) $$,
  'the cache is keyed on the link exactly as pasted'
);
select throws_ok(
  $$ insert into public.proposals (meal_id, place_name, source_url, place_cid, lat, lng)
     values ('a0000000-0000-0000-0000-000000000001', 'Forged',
             'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA', '1', 0, 0) $$,
  '42501', null,
  'a member cannot send a place of their own: it only comes from the cache'
);
select throws_ok(
  $$ update public.proposals set lat = 0, lng = 0 where place_name = 'NTUST cafeteria' $$,
  '42501', null,
  'nor move a proposal''s place afterwards'
);

select results_eq(
  $$ select place_cid, lat, lng from public.proposals where place_name = 'NTUST cafeteria' $$,
  $$ values ('11272421852253356408'::text,
             25.0140156::double precision, 121.542539::double precision) $$,
  'members read the stored place with the proposal'
);

-- service_role, making a proposal with a place of its own, keeps it ----------------

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select results_eq(
  $$ insert into public.proposals (meal_id, proposed_by, place_name, source_url, place_cid, lat, lng)
     values ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
             'Given', 'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA', '42', 1, 2)
     returning place_cid, lat, lng $$,
  $$ values ('42'::text, 1::double precision, 2::double precision) $$,
  'a place given by service_role is not overwritten from the cache'
);

-- The decided restaurant's calendar event links to the pasted link ------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

insert into public.decisions (meal_id, proposal_id)
select meal_id, id from public.proposals where place_name = 'NTUST cafeteria';

reset role;
set local role service_role;
set local request.jwt.claims to '{"role": "service_role"}';

select results_eq(
  $$ select place_name, source_url, lat, lng
     from public.claim_calendar_events('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  $$ values ('NTUST cafeteria'::text, 'https://maps.app.goo.gl/2avW6UjkkDbgHUwPA'::text,
             25.0140156::double precision, 121.542539::double precision) $$,
  'claiming a decided meal for its calendar event hands over the pasted link too'
);

select * from finish();
rollback;
