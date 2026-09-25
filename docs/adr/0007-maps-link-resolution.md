# Maps short links are resolved by hand over TLS, once, and the database fills the place in

Status: accepted (#9)

## Context

#9 turns a pasted `maps.app.goo.gl` link into the restaurant's name, and keeps
its coordinates and CID beside the link. The PRD (#1) settles the rules: the
request sends no `User-Agent` and does not follow the redirect; coordinates
come from `!3d`/`!4d`, never `@lat,lng`; the CID is the second half of the
`!1s` feature id; results are cached for good against the source URL; any
failure falls back silently to typing the name.

Four things were left open: how to send a request with no `User-Agent` from
an Edge Function, how the coordinates and CID reach the proposal, what the
cache keeps for a link that could not be resolved, and where "Open in Google
Maps" should go once a proposal has a place.

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
  (`redirectRequest`, `readReply`), unit-tested with the rest of the parsing.
  The whole exchange has a 5-second limit.
- **Only `https://maps.app.goo.gl/<id>` is ever asked** (`shortLink`), so the
  function cannot be pointed at another host. It serves signed-in users only.
- **The database fills in the place.** `public.maps_links` holds each link's
  resolution, keyed on the link exactly as pasted (trimmed), the way
  `proposals.source_url` stores it. A `before insert` trigger on `proposals`
  copies the CID and coordinates from there. Clients still have no grant on
  `place_cid`, `lat` or `lng`, so a proposal's place can only be what Google
  said about its link, never whatever a request carried. Only service_role
  (the function) reads or adds to the cache; nobody updates or deletes it.
- **Only Google's answers are cached; no answer is not** (the maintainer's
  decision on #9). `readReply` sorts a reply three ways:
  - a redirect: its address is parsed, and the place, or "could not parse"
    (a search, directions, an address missing its place segment, coordinates
    or feature id), is kept for good;
  - a 404 or 410: Google says the link does not exist. A dead short link does
    not come back, so this is kept for good too, as a row with no place;
  - anything else: a timeout, a failed connection or TLS handshake, a 429, a
    5xx, a 200 page with no `Location`, a 3xx with none usable, a reply cut
    short. Nothing is kept, and a later paste of the same link asks again.
    There is still no retry within a request.
    To the app all failures look the same: no place, and the name is left to
    the member, with nothing said.
- **The CID is stored in decimal**, as `https://maps.google.com/?cid=` takes it
  (at most 20 digits).
- **The app looks a link up when it is pasted, or when a typed link's field is
  left**, not on every keystroke: a half-typed link is still a well-formed
  short link, and Google's 404 for it would be kept for good. The resolved
  name is filled in only while the name field is empty (or still holds the
  previous lookup's name), and only if the link has not changed since.
- **"Open in Google Maps" opens the link the proposer pasted, when there is
  one** (the maintainer's decision on #9). This goes for a proposal, the
  decided restaurant, and the calendar event's link (#12), which is why
  `claim_calendar_events` now returns `source_url`. The pasted link opens the
  place's own page: its listing, reviews and hours. The official Maps URLs
  scheme can name a place only by a Places `place_id` (`query_place_id`),
  which short links do not give, so from our coordinates it could only drop a
  pin, and from the name only run a search that may land on another branch.
  Without a pasted link (a name typed by hand), the official scheme's search
  is still used.

  This knowingly relaxes #9's "Outbound links use the official Maps URLs
  scheme" and the PRD's "All outbound links use the official, key-free Maps
  URLs scheme". That rule was there so a pasted link could never send anyone
  elsewhere. What remains of it: the link is a member's own input, the
  database and the form accept only `http(s)` links, `mapsUrl` links to
  nothing else, and it opens in a new tab with `noopener noreferrer`. The
  form does not insist the link is Google's, so a member could paste any web
  address and the group would be sent there; within a trip of people who
  invited each other, that is accepted.

## Considered and not chosen

| Option                                                     | Why not                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch(url, { redirect: "manual" })`                       | Sends Deno's `User-Agent`, which the ticket rules out and a test could not show otherwise.                                                                    |
| The client sends `place_cid`, `lat`, `lng` with the insert | A member could put any coordinates on a proposal. Filling them from the cache costs a trigger and keeps the rule in the database, like every other rule here. |
| Cache every outcome, timeouts included                     | One passing network failure would stop a link from ever filling in the name.                                                                                  |
| Cache only successes                                       | A link Google has answered for (not a place, or dead) would be asked again on every paste, which "never resolved twice" rules out.                            |
| The official scheme with coordinates, as #8 had it         | Opens a dropped pin, not the restaurant.                                                                                                                      |

## Consequences

- The place is copied only at insert, so proposing waits for a lookup of the
  same link that is still under way (at most the function's 5 seconds). A
  proposal made with a link nobody looked up, or whose lookup got no answer,
  has no place, though its Maps link still opens what was pasted.
- A link whose lookup got no answer is asked again on its next paste. If
  Google starts answering everything with a page instead of a redirect, every
  paste asks once and gets nothing; the cost is one request per paste.
- Deleting the `maps-link` function turns autofill off without touching
  proposing: the app treats every failure, a missing function included, as a
  link that could not be resolved.
- `maps_links` grows by one row per distinct link Google answered for, for
  good. At a few trips of up to 8 people this is negligible on the free tier.
- The calendar function reads `source_url` from the claim, so both functions
  are deployed with this migration.
