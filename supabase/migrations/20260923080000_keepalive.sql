-- Target for the scheduled keepalive ping (.github/workflows/keepalive.yml).
--
-- A free-tier project pauses after about a week without activity and cannot
-- wake itself, so GitHub Actions calls this every 3 days through the Data API
-- with the publishable key. It runs a real query but reads no table, so
-- exposing it to `anon` leaks nothing.
--
-- Keep this function when rewriting the schema: supabase/tests/database/
-- keepalive.test.sql fails if it disappears or anon loses EXECUTE.
create function public.keepalive()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1
$$;

-- Postgres grants EXECUTE to PUBLIC by default, and the Data API's default
-- privileges add anon and authenticated. Take all of that back, then grant
-- the one role the ping uses.
revoke all on function public.keepalive() from public, anon, authenticated;
grant execute on function public.keepalive() to anon;
