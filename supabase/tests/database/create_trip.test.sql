-- Creating a trip makes the creator its organiser in the same step, and a
-- trip carries a name, an optional date range and an IANA timezone.
begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- The creator becomes the organiser without a separate step -----------------

select results_eq(
  $$ select name, timezone, start_date, end_date
     from public.create_trip('Tokyo', 'Asia/Tokyo', '2026-10-01', '2026-10-05') $$,
  $$ values ('Tokyo'::text, 'Asia/Tokyo'::text, '2026-10-01'::date, '2026-10-05'::date) $$,
  'create_trip() returns the new trip'
);
select results_eq(
  $$ select m.user_id, m.role::text, m.left_at is null
     from public.trip_members m
     join public.trips t on t.id = m.trip_id
     where t.name = 'Tokyo' $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'organiser'::text, true) $$,
  'the creator is the new trip''s only member, as its organiser'
);
select results_eq(
  $$ select name from public.trips $$,
  array['Tokyo'],
  'the creator reads the trip they just created'
);

-- A trip without dates is valid (daily, non-travel use).
select results_eq(
  $$ select start_date is null and end_date is null
     from public.create_trip('Tonight', 'Asia/Taipei') $$,
  array[true],
  'a trip may have no dates'
);

-- Another user sees neither trip.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

select is_empty(
  $$ select id from public.trips $$,
  'someone else''s new trips are invisible to a stranger'
);

-- Creating a trip is the only way in ---------------------------------------

select throws_ok(
  $$ insert into public.trips (name, timezone) values ('Sneaky', 'Asia/Tokyo') $$,
  '42501', null,
  'a trip cannot be inserted directly, bypassing its organiser'
);

-- Validation ------------------------------------------------------------------

select throws_ok(
  $$ select public.create_trip('Nowhere', 'Mars/Olympus_Mons') $$,
  '23514', null,
  'an unknown timezone is rejected'
);
select throws_ok(
  $$ select public.create_trip('Offset', 'UTC+8') $$,
  '23514', null,
  'a POSIX offset is not an IANA timezone'
);
select lives_ok(
  $$ select public.create_trip('London', 'Europe/London') $$,
  'an IANA timezone is accepted'
);
select throws_ok(
  $$ select public.create_trip('  ', 'Asia/Tokyo') $$,
  '23514', null,
  'a blank name is rejected'
);
select throws_ok(
  $$ select public.create_trip('Backwards', 'Asia/Tokyo', '2026-10-05', '2026-10-01') $$,
  '23514', null,
  'an end date before the start date is rejected'
);
select throws_ok(
  $$ select public.create_trip('Half', 'Asia/Tokyo', '2026-10-05') $$,
  '23514', null,
  'a start date without an end date is rejected'
);

-- One organiser per trip, and the organiser cannot be a departed member -----

reset role;

select throws_ok(
  $$ insert into public.trip_members (trip_id, user_id, role)
     select id, '22222222-2222-2222-2222-222222222222', 'organiser'
     from public.trips where name = 'Tokyo' $$,
  '23505', null,
  'a trip cannot have a second organiser'
);
select throws_ok(
  $$ update public.trip_members set left_at = now()
     where user_id = '11111111-1111-1111-1111-111111111111' and role = 'organiser' $$,
  '23514', null,
  'the organiser cannot depart without handing over the role'
);

select * from finish();

rollback;
