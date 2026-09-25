-- Resolved Maps short links (#9). See docs/adr/0007-maps-link-resolution.md.
--
-- The maps-link Edge Function asks maps.app.goo.gl where a pasted short link
-- points and reads the place (name, CID, coordinates) from the address. What
-- it learns is kept here, for good, keyed by the link exactly as pasted: the
-- same link is never resolved twice. A link that could not be resolved (not
-- a place, a timeout, anything but a redirect) is kept too, with no place, so
-- it is not asked again either.
--
-- A proposal made with a link takes its CID and coordinates from here, in a
-- trigger, rather than from the client. The client only ever sends the name,
-- the link and the note (the grants in 20260926090000_proposals.sql), so what
-- a proposal says about where the restaurant is can only be what Google said
-- about the link, never whatever a member typed into a request.
--
-- All of this is a convenience. Nothing here can refuse a proposal: a link
-- with no resolution, or one that could not be resolved, just leaves the
-- place empty, and the name is whatever the member typed or kept.

create table public.maps_links (
  -- As pasted (trimmed), which is how proposals.source_url stores it too.
  source_url text primary key
    check (
      source_url ~ '^https://maps\.app\.goo\.gl/'
      and char_length(source_url) <= 2000
    ),
  -- The place, or all four null when the link could not be resolved. The name
  -- is the one Maps gives; the proposer may change theirs, never this.
  place_name text check (place_name = btrim(place_name) and char_length(place_name) between 1 and 2000),
  -- In decimal, as https://maps.google.com/?cid= takes it: the second half of
  -- the `!1s` feature id. A CID fits in 64 bits, so at most 20 digits.
  place_cid text check (place_cid ~ '^[1-9][0-9]{0,19}$'),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  resolved_at timestamptz not null default now(),
  check (num_nulls(place_name, place_cid, lat, lng) in (0, 4))
);

comment on table public.maps_links is
  'What each pasted Maps short link resolved to, kept for good (#9). Written only by the maps-link Edge Function.';

-- Only the Edge Function, as service_role, reads and adds; nobody changes or
-- removes a resolution. RLS is on with no policy, so a client role that ever
-- gained a grant here would still see nothing.
alter table public.maps_links enable row level security;

revoke all on public.maps_links from anon, authenticated, service_role;
grant select, insert on public.maps_links to service_role;

-- Filling a proposal's place ----------------------------------------------------------
-- Before insert, so the place is part of the row from the start, like the
-- link it came from (neither has an update grant). A place given explicitly,
-- which only service_role can do, is kept.
--
-- SECURITY DEFINER: the member proposing cannot read maps_links.
create function private.fill_proposal_place()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_url is not null and new.place_cid is null and new.lat is null and new.lng is null then
    select l.place_cid, l.lat, l.lng
      into new.place_cid, new.lat, new.lng
      from public.maps_links l
      where l.source_url = new.source_url;
  end if;
  return new;
end;
$$;

create trigger proposals_fill_place
  before insert on public.proposals
  for each row execute function private.fill_proposal_place();

revoke all on function private.fill_proposal_place() from public, anon, authenticated, service_role;
