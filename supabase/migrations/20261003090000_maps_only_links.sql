-- A proposal's link is a Google Maps link, or none. See
-- docs/adr/0007-maps-link-resolution.md.
--
-- The link is what "Open in Google Maps" opens, for the proposal, the decided
-- restaurant and its calendar event. Until now any http(s) address was kept,
-- so a member could send the group anywhere, a malicious page included, under
-- a Google Maps label. Now only these are kept, as apps/web/src/proposals/
-- proposal.ts checks them too:
--
--   https://maps.app.goo.gl/<id>              a share sheet's short link
--   https://maps.google.<country>/...
--   https://(www.)google.<country>/maps...
--
-- The host must end right where it is spelled out, so a user name, a port or
-- another domain around it cannot point the link elsewhere. Anything else a
-- member wants to share goes in the note, which is only ever shown as text.

-- A link kept before that is not a Maps link is dropped. The app already
-- stopped linking to it (mapsUrl falls back to a search for the place); the
-- proposal, its name and note stay. A decided meal whose restaurant lost its
-- link has its calendar event rewritten, so the event stops linking there too.
with dropped as (
  update public.proposals
  set source_url = null
  where source_url is not null
    and source_url !~* '^https://(maps\.app\.goo\.gl/[a-z0-9_-]+([?#]|$)|maps\.google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})([/?#]|$)|(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})/maps([/?#]|$))'
  returning id
)
select private.queue_calendar_events(
  array(select d.meal_id from public.decisions d where d.proposal_id in (select id from dropped))
);

alter table public.proposals drop constraint proposals_source_url_check;
alter table public.proposals add constraint proposals_source_url_check
  check (
    source_url = btrim(source_url)
    and char_length(source_url) between 1 and 2000
    and source_url ~* '^https://(maps\.app\.goo\.gl/[a-z0-9_-]+([?#]|$)|maps\.google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})([/?#]|$)|(www\.)?google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})/maps([/?#]|$))'
  );
