-- Smoke test for the CI harness: proves pgTAP runs against a database that has
-- the migrations applied, without depending on any particular table.
--
-- Pattern for later tests: one file per concern in supabase/tests/database/,
-- named *.test.sql, wrapped in a transaction that is rolled back.
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select has_schema('public', 'public schema exists');
select ok(
  (select count(*) from supabase_migrations.schema_migrations) > 0,
  'migrations have been applied'
);

select * from finish();

rollback;
