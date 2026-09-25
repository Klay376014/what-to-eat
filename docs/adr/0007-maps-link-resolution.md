# Maps short links are resolved by hand over TLS, once, and the database fills the place in

Status: accepted (#9)

## Context

#9 turns a pasted `maps.app.goo.gl` link into the restaurant's name, and keeps
its coordinates and CID beside the link. The PRD (#1) settles the rules: the
request sends no `User-Agent` and does not follow the redirect; coordinates
come from `!3d`/`!4d`, never `@lat,lng`; the CID is the second half of the
`!1s` feature id; results are cached for good against the source URL; any
failure falls back silently to typing the name.

Three things were left open: how to send a request with no `User-Agent` from
an Edge Function, how the coordinates and CID reach the proposal, and what
the cache keeps for a link that could not be resolved.

## Decision

See `supabase/functions/maps-link/`, `apps/web/src/proposals/mapsLink.ts` and
`supabase/migrations/20260930120000_maps_links.sql`.

- **The request is written by hand over TLS.** Deno's `fetch()` always adds
  `User-Agent: Deno/<version>`, and an empty value still sends the header.
  (Deno's own agent does get a 302 today, but the ticket asks for none, and a
  header we cannot remove is one Google could start treating as a browser's.)
  So the function opens a TLS connection to `maps.app.goo.gl:443`, sends
  `GET /<id> HTTP/1.1` with only `Host` and `Connection: close`, reads the
  reply's head and takes `Location` from a 3xx. Nothing follows the redirect.
  Building the request and reading the head are pure functions
  (`redirectRequest`, `redirectLocation`), unit-tested with the rest of the
  parsing. The whole exchange has a 5-second limit.
- **Only `https://maps.app.goo.gl/<id>` is ever asked** (`shortLink`), so the
  function cannot be pointed at another host. It serves signed-in users only.
- **The database fills in the place.** `public.maps_links` holds each link's
  resolution, keyed on the link exactly as pasted (trimmed), the way
  `proposals.source_url` stores it. A `before insert` trigger on `proposals`
  copies the CID and coordinates from there. Clients still have no grant on
  `place_cid`, `lat` or `lng`, so a proposal's place can only be what Google
  said about its link, never whatever a request carried. Only service_role
  (the function) reads or adds to the cache; nobody updates or deletes it.
- **A link that could not be resolved is cached too**, as a row with no place.
  "The same link is never resolved twice" and "never retried" together say so,
  and a timeout or a non-redirect behaves exactly like a parse failure. The
  cost: a link that failed once for a passing reason (a timeout) never
  autofills. The member types the name, as they would for any failure.
- **The CID is stored in decimal**, as `https://maps.google.com/?cid=` takes it
  (at most 20 digits).
- **The app looks a link up when it is pasted, or when a typed link's field is
  left**, not on every keystroke: a half-typed link is still a well-formed
  short link, and caching its failure would be permanent. The resolved name is
  filled in only while the name field is empty (or still holds the previous
  lookup's name), and only if the link has not changed since.

## Considered and not chosen

| Option                                                     | Why not                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch(url, { redirect: "manual" })`                       | Sends Deno's `User-Agent`, which the ticket rules out and a test could not show otherwise.                                                                    |
| The client sends `place_cid`, `lat`, `lng` with the insert | A member could put any coordinates on a proposal. Filling them from the cache costs a trigger and keeps the rule in the database, like every other rule here. |
| Cache only successes                                       | Contradicts "never resolved twice"; a broken link would be asked again on every paste.                                                                        |

## Consequences

- The place is copied only at insert, so proposing waits for a lookup of the
  same link that is still under way (at most the function's 5 seconds). A
  proposal made with a link nobody looked up (one typed and submitted without
  leaving the field, say) has no place; its Maps link searches by name.
- Once a proposal has coordinates, its Maps link (`mapsUrl`, from #8) searches
  for them, which opens a pin at the place rather than its listing. The
  official Maps URLs scheme takes a `query_place_id`, but only a Places
  `place_id`, which short links do not give.
- Deleting the `maps-link` function turns autofill off without touching
  proposing: the app treats every failure, a missing function included, as a
  link that could not be resolved.
- `maps_links` grows by one row per distinct link pasted, for good. At a few
  trips of up to 8 people this is negligible on the free tier.
