-- Who holds which privilege on invitations and the membership functions.
-- The behaviour lives in invitations.test.sql, member_limit.test.sql and
-- membership.test.sql; this file pins the grants that behaviour relies on.
-- (trips_schema.test.sql already checks, for every table in public, that RLS
-- is on and that anon holds nothing.)
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

select has_table('public', 'invitations', 'invitations exists');
select col_is_unique('public', 'invitations', 'token', 'no two invitations share a token');

-- Invitations are read by the organiser, subject to RLS, and written only
-- through the functions: no client picks a token, an expiry or un-revokes.
select table_privs_are(
  'public', 'invitations', 'authenticated', array['SELECT'],
  'authenticated may only read invitations, subject to RLS'
);
select table_privs_are(
  'public', 'invitations', 'anon', array[]::text[],
  'anon holds no privilege on invitations'
);
select table_privs_are(
  'public', 'trip_members', 'authenticated', array['SELECT'],
  'membership changes go through the functions, never a direct write'
);

select function_privs_are(
  'public', 'create_invitation', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can call create_invitation'
);
select function_privs_are(
  'public', 'revoke_invitation', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can call revoke_invitation'
);
select function_privs_are(
  'public', 'join_trip', array['text'], 'authenticated', array['EXECUTE'],
  'authenticated can call join_trip'
);
select function_privs_are(
  'public', 'remove_member', array['uuid', 'uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can call remove_member'
);
select function_privs_are(
  'public', 'leave_trip', array['uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can call leave_trip'
);
select function_privs_are(
  'public', 'transfer_organiser', array['uuid', 'uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can call transfer_organiser'
);

select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('create_invitation', 'revoke_invitation', 'join_trip',
                         'remove_member', 'leave_trip', 'transfer_organiser')
       and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon can call none of the invitation or membership functions'
);
select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_invitation', 'revoke_invitation', 'join_trip',
                       'remove_member', 'leave_trip', 'transfer_organiser')
     and p.prosecdef),
  6,
  'every invitation and membership function is security definer'
);

-- The private helpers are reachable by nobody by name.
select is_empty(
  $$ select p.proname from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and p.proname in ('new_invitation_token', 'enforce_member_limit',
                         'keep_an_organiser', 'trip_member_limit')
       and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('anon', p.oid, 'EXECUTE')) $$,
  'no client role can execute the private invitation helpers'
);
select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('new_invitation_token', 'enforce_member_limit',
                       'keep_an_organiser', 'trip_member_limit')),
  4,
  'the private helper check above has functions to inspect'
);
select policies_are(
  'public', 'invitations', array['invitations_select'],
  'invitations has a read policy and nothing else'
);

select * from finish();

rollback;
