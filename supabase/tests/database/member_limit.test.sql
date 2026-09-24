-- A trip holds at most 8 current members.
--
-- The limit is a product decision (#1): past eight, voting on each proposal
-- stops being coordination and becomes a survey nobody fills in. It is
-- enforced by a trigger on trip_members, so it holds on every path that adds
-- or brings back a member, not only through join_trip(). The trigger locks the
-- trip's row before counting, so two people joining at the same moment queue
-- behind each other instead of both seeing seven.
--
-- Concurrency itself cannot be exercised here: a pgTAP file runs in one
-- session and one transaction. What is tested is the rule the lock protects.
--
-- Cast: trip A, organised by m1, with members m2..m7 (seven current members)
-- and one departed member, gone. Outsiders o1 and o2 hold a valid link.
begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'm' || n || '@example.com'
from generate_series(1, 9) n;
insert into auth.users (id, email) values
  ('0000000a-0000-0000-0000-000000000001', 'o1@example.com'),
  ('0000000a-0000-0000-0000-000000000002', 'o2@example.com'),
  ('0000000d-0000-0000-0000-000000000001', 'gone@example.com');

insert into public.trips (id, name, timezone) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Kyoto', 'Asia/Tokyo');

insert into public.trip_members (trip_id, user_id, role, joined_at)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       ('00000000-0000-0000-0000-00000000000' || n)::uuid,
       case when n = 1 then 'organiser' else 'member' end::public.trip_role,
       now() - interval '3 days'
from generate_series(1, 7) n;
insert into public.trip_members (trip_id, user_id, role, joined_at, left_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0000000d-0000-0000-0000-000000000001', 'member',
   now() - interval '3 days', now() - interval '2 days');

insert into public.invitations (trip_id, token, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', repeat('k', 43), '00000000-0000-0000-0000-000000000001');

-- The eighth member gets in; the departed member takes no place ---------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "0000000a-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  public.join_trip(repeat('k', 43)),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'the eighth member joins; a departed member does not count towards the limit'
);

-- The ninth does not ----------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0000000a-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$ select public.join_trip(repeat('k', 43)) $$,
  'P0001', 'trip_full',
  'a ninth member is refused'
);
select is_empty(
  $$ select id from public.trips $$,
  'the refused ninth member reads nothing of the trip'
);

-- A member of a full trip opening the link again is simply let in.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0000000a-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  public.join_trip(repeat('k', 43)),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'a current member reopening the link of a full trip is taken in, not refused'
);

-- The organiser of a full trip is told so when inviting ------------------------

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'P0001', 'trip_full',
  'the organiser of a full trip cannot issue another invitation'
);

-- Every other path is held to the same limit ----------------------------------
-- Even the table owner, who bypasses RLS, cannot add a ninth member or bring a
-- departed one back while the trip is full.

reset role;

select throws_ok(
  $$ insert into public.trip_members (trip_id, user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000009') $$,
  'P0001', 'trip_full',
  'a ninth membership cannot be inserted directly'
);
select throws_ok(
  $$ update public.trip_members set left_at = null
     where user_id = '0000000d-0000-0000-0000-000000000001' $$,
  'P0001', 'trip_full',
  'a departed member cannot be brought back into a full trip'
);
select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and left_at is null),
  8,
  'the trip still has exactly eight current members'
);

-- Someone leaving frees a place --------------------------------------------------

set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-000000000007", "role": "authenticated"}';

select lives_ok(
  $$ select public.leave_trip('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'a member leaves the full trip'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.create_invitation('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  'with a place free, the organiser can invite again'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0000000a-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  public.join_trip(repeat('k', 43)),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'with a place free, the next person joins'
);

-- ...and the trip is full again.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.remove_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000006') $$,
  'removing a member also frees a place'
);

reset role;
select lives_ok(
  $$ insert into public.trip_members (trip_id, user_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000009') $$,
  'with a place free, a membership can be added'
);
select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and left_at is null),
  8,
  'the trip never went past eight current members'
);

select * from finish();

rollback;
