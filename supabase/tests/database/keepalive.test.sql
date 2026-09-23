-- The keepalive workflow calls public.keepalive() with the publishable key
-- (role anon). If a schema rewrite drops the function or anon's EXECUTE, the
-- hosted project would quietly start pausing again -- fail here instead.
begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select has_function(
  'public', 'keepalive', array[]::text[],
  'public.keepalive() exists'
);
select function_privs_are(
  'public', 'keepalive', array[]::text[], 'anon', array['EXECUTE'],
  'anon can execute public.keepalive()'
);

set local role anon;
select is(public.keepalive(), 1, 'public.keepalive() returns 1 as anon');
reset role;

select * from finish();

rollback;
