-- Lunch/dinner restaurant proposals for a small, closed group.
--
-- Access model: `members` is the allowlist. Every other table's RLS policies
-- ask `public.is_member()`, so an authenticated stranger who signs in with
-- Google sees nothing until someone inserts them into `members`.

create extension if not exists pgcrypto with schema extensions;

create type public.meal_slot as enum ('lunch', 'dinner');

-- The allowlist. Rows are added by hand (SQL editor) -- there is no sign-up
-- flow, because the group is 2-3 people who already know each other.
create table public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so the membership check itself is not subject to the RLS
-- policy on `members`, which would recurse.
create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members where user_id = (select auth.uid())
  )
$$;

-- One row per date+slot. The unique constraint is what stops two people from
-- opening a competing thread for the same meal.
create table public.meals (
  id uuid primary key default extensions.gen_random_uuid(),
  meal_date date not null,
  slot public.meal_slot not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (meal_date, slot)
);

create table public.proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  meal_id uuid not null references public.meals (id) on delete cascade,
  place_name text not null check (length(trim(place_name)) > 0),
  -- Google Maps place id and share link. Storing the id (not just an address)
  -- is what makes "tap to navigate" work later.
  place_id text,
  place_url text,
  note text,
  proposed_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (meal_id, place_name),
  -- Target for the composite FK in `decisions`.
  unique (id, meal_id)
);

create index proposals_meal_id_idx on public.proposals (meal_id);

create table public.votes (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- -1 veto, 1 yes. No 0: "no opinion" is the absence of a row.
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create index votes_user_id_idx on public.votes (user_id);

-- One decision per meal. `meal_id` is the PK, so re-deciding is an upsert.
create table public.decisions (
  meal_id uuid primary key references public.meals (id) on delete cascade,
  proposal_id uuid not null,
  -- Google Calendar event id, so a changed decision updates the event instead
  -- of leaving a stale one behind.
  calendar_event_id text,
  decided_by uuid not null references auth.users (id),
  decided_at timestamptz not null default now(),
  -- Composite FK: the chosen proposal must belong to the meal being decided.
  foreign key (proposal_id, meal_id)
    references public.proposals (id, meal_id) on delete cascade
);

-- RLS ---------------------------------------------------------------------

alter table public.members enable row level security;
alter table public.meals enable row level security;
alter table public.proposals enable row level security;
alter table public.votes enable row level security;
alter table public.decisions enable row level security;

-- Members can see each other (needed to render "proposed by Klay"), but the
-- allowlist itself is only editable from the dashboard.
create policy members_select on public.members
  for select to authenticated using (public.is_member());

create policy meals_select on public.meals
  for select to authenticated using (public.is_member());
create policy meals_insert on public.meals
  for insert to authenticated
  with check (public.is_member() and created_by = (select auth.uid()));

create policy proposals_select on public.proposals
  for select to authenticated using (public.is_member());
create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (public.is_member() and proposed_by = (select auth.uid()));
-- You may edit or retract only your own proposal.
create policy proposals_update on public.proposals
  for update to authenticated
  using (public.is_member() and proposed_by = (select auth.uid()))
  with check (proposed_by = (select auth.uid()));
create policy proposals_delete on public.proposals
  for delete to authenticated
  using (public.is_member() and proposed_by = (select auth.uid()));

create policy votes_select on public.votes
  for select to authenticated using (public.is_member());
create policy votes_write on public.votes
  for all to authenticated
  using (public.is_member() and user_id = (select auth.uid()))
  with check (public.is_member() and user_id = (select auth.uid()));

-- Any member may call the decision, and change it. With three people, "whoever
-- pulls the trigger" beats an automatic winner -- 1:1:1 ties are the norm.
create policy decisions_select on public.decisions
  for select to authenticated using (public.is_member());
create policy decisions_write on public.decisions
  for all to authenticated
  using (public.is_member())
  with check (public.is_member() and decided_by = (select auth.uid()));

-- Grants ------------------------------------------------------------------
-- Stated explicitly rather than relying on the Data API's implicit grants.

grant select on public.members to authenticated;
grant select, insert on public.meals to authenticated;
grant select, insert, update, delete on public.proposals to authenticated;
grant select, insert, update, delete on public.votes to authenticated;
grant select, insert, update, delete on public.decisions to authenticated;

grant execute on function public.is_member() to authenticated;

-- `anon` gets nothing. On a project where the Data API still auto-exposes new
-- tables, CREATE TABLE hands anon a SELECT grant; these revokes take it back
-- so an unauthenticated caller cannot read the group's plans.
revoke all on public.members from anon;
revoke all on public.meals from anon;
revoke all on public.proposals from anon;
revoke all on public.votes from anon;
revoke all on public.decisions from anon;
revoke all on function public.is_member() from anon, public;
