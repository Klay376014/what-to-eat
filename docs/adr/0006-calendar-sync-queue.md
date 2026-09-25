# Decided meals reach the calendar through a queue in the database

Status: accepted (#12)

## Context

#12 makes a decided meal an event on a secondary calendar that one member
connects, with the trip's members as attendees. The PRD (#1) asks for writes to
be queued rather than synchronous:

- a meal can be decided before anyone connects a calendar;
- connecting writes every waiting decision in one pass;
- a failed write is a visible status, not a lost decision.

The project is on the Supabase free tier, with no Edge Function or cron job
until now. The refresh token must never reach a browser.

## Decision

**The database queues; the calendar Edge Function writes; the app asks it to.**
See `supabase/migrations/20260929090000_calendar.sql` and
`supabase/functions/calendar/`.

- `public.calendar_events` has a row per meal that has, or needs, an event.
  Triggers queue the meal (`status = 'pending'`, `revision + 1`) whenever
  something its event shows changes: the decision is made, changed or
  cleared; the meal's time, day or name changes; the decided restaurant's
  note or place changes; the trip's timezone changes; or a member joins,
  leaves, or opts out of or back into being a guest (the attendees, #14).
  The queue does not care whether a calendar exists
  yet, which is what lets a meal be decided with none.
- The Edge Function claims a trip's waiting meals (`claim_calendar_events`,
  a five-minute lease), writes each one, and records the result against the
  revision it claimed (`finish_calendar_event`). A change that lands during
  the write leaves the meal queued for the next pass. A failure is recorded
  with its message, and members see it on the meal.
- The app calls the function (`sync`) after each change it makes, and when a
  trip opens with meals still waiting. Connecting (`connect`) runs the same
  pass straight after making the calendar.
- Each event's id is fixed by its meal (the meal's uuid without dashes;
  Google accepts client-chosen ids in base32hex). A write retried after a lost
  response finds the event it already made, so it cannot make a second one.
  Updating an event that no longer exists falls back to creating it, and a
  create that meets an existing id updates it.
- Every event write is paced (400 ms apart) and retried with exponential
  backoff on `403 rateLimitExceeded` or `429`. Calendar creation runs one at a
  time per function instance, and a trip claims its calendar row first, so two
  members connecting at once cannot both make a calendar.
- The calendar holder is not an attendee: the event is on their calendar
  already, and an invitation would add a second copy to their primary one.
- The summary and first line of the description state the meal's local time
  and zone ("Dinner · Ichiran (19:00 Tokyo)"). Google shows every attendee the
  instant in their own zone (spike #2), so a group planning Tokyo from Taipei
  would otherwise read every meal an hour early.

## Considered and not chosen

| Option                                                                            | Why not                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write to Google in the same request as the decision                               | Deciding with no calendar would be impossible or a special case, and Google being slow or down would fail the decision itself.                                                                                  |
| `pg_cron` + `pg_net` calling the function on a schedule, or on every queue insert | Needs the function's URL and a secret key stored in the database, and more setup on the hosted project. The app's call covers the normal case. A scheduled sweep can be added later without changing the queue. |
| Store only the event id on `decisions`                                            | Clearing a decision deletes its row, and with it the id of the event to delete. The queue row outlives the decision until the event is gone.                                                                    |

## Consequences

- A change made by a member who closes the tab before the call lands stays
  queued, and is shown as "not on the calendar yet", until anyone opens the
  trip. This is the gap a scheduled sweep would close.
- Handover to a new holder and a lapsed refresh token are #13's: see
  [ADR 0008](0008-calendar-handover.md). A dead connection is recorded on the
  grant rather than on each meal, and a takeover re-queues every decided meal
  through this same queue.
- A member who opts out (#14, `public.calendar_opt_outs`, per member per
  trip, readable and changeable by that member alone) is left out by
  `calendar_attendees()`. Opting out or back in queues the trip's meals like
  any other attendee change, so events already written are rewritten without
  them, or with them, on the next pass. The choice can be made at joining,
  where `join_trip` takes it and stores it with the membership: set a moment
  later, a pass in between could already have invited them. See
  `supabase/migrations/20260930090000_calendar_opt_out.sql`.
