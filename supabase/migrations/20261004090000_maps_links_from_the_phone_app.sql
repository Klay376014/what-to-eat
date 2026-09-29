-- Maps short links shared from the phone app (#37). See
-- docs/adr/0007-maps-link-resolution.md.
--
-- A link shared from desktop Maps is sent to a place address, which carries
-- the place's name, feature id and coordinates. One shared from the phone app
-- is sent to a search for "<name>, <address>" with the feature id beside it
-- (maps.google.com?q=…&ftid=0x…:0x…), and no coordinates at all. So a place
-- is now its name and CID, with coordinates when the address had them.

alter table public.maps_links drop constraint maps_links_check;
alter table public.maps_links add constraint maps_links_place_check
  check (
    num_nulls(place_name, place_cid) in (0, 2)
    and (lat is null) = (lng is null)
    and (place_name is not null or lat is null)
  );

-- Until now a phone link was kept as "no place", for good, so pasting it
-- again would never fill the name in. What a link was sent to is not kept,
-- so those rows cannot be told from the rest: every link kept without a
-- place is let go, and is asked about once more on its next paste. The few
-- that really are not places (a search, directions, a 404) are kept again
-- then, at the cost of one request each. Proposals already made with one of
-- these links keep their empty place: a place is only filled in at insert.
delete from public.maps_links where place_name is null;
