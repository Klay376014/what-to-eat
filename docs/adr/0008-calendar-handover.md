# A dead calendar connection is loud, and any member takes it over onto a new calendar

Status: accepted (#13)

## Context

The trip calendar lives on one member's Google account, written with their
refresh token (#12, [ADR 0006](0006-calendar-sync-queue.md)). That connection
will die. Google drops a refresh token left unused for six months, and this
app is used in bursts months apart. The holder may also revoke access, delete
the calendar, or leave the trip. A calendar that silently stopped updating is
worse than none: people trust it and go to the wrong restaurant.

The PRD (#1, stories 60–63) settles the shape: any member can recover, the
new holder gets a fresh secondary calendar with the trip's decided events
recreated on it, and the app cannot delete the old calendar, so the UI asks
the new holder to have the previous one delete it. Duplicates are preferred
to stale events.

## Decision

See `supabase/migrations/20261001090000_calendar_handover.sql` and
`supabase/functions/calendar/`.

- **The grant says when it stopped working, and why.** `calendar_grants`
  gains `lapsed_at` and `lapse_reason` (`revoked`, `calendar_gone`,
  `holder_left`), readable by every member. The Edge Function records a lapse
  with `lapse_calendar` when the token endpoint answers `invalid_grant`, the
  Calendar API answers 401, or inserting an event meets a 404 (only the
  calendar itself can be missing then). The token endpoint's other refusals,
  such as a 401 `invalid_client` for a wrong client secret, are the server's
  fault and lapse nothing; nor do 5xx, throttling or one bad event, which stay
  per-meal failures retried as before. The lapse names the calendar and the
  token the pass used, so a pass that outlived its token cannot undo a
  reconnection made meanwhile. The dead token is dropped: `refresh_token`
  becomes nullable, and null only on a lapsed grant.
- **It is found out when the trip opens**, not only at the next decision:
  the trip asks the Edge Function for a pass whenever it opens with a working
  calendar, and a pass with nothing queued still exchanges the refresh token.
  That also counts as using the token, which is what keeps Google from
  expiring it for disuse while the trip is being looked at.
- **It is shown at the top of the trip**, above the days (`CalendarAlert.vue`),
  with the button that fixes it, and each decided meal says its event will not
  follow later changes. A lapsed calendar writes nothing; its queue waits.
- **The holder leaving is a lapse.** A trigger on `trip_members.left_at` marks
  their grant `holder_left` and drops their token, for leaving and removal
  alike. The grant stays, so the members left see whose calendar it was. The
  leave and remove dialogs say this first, and handing over the organiser role
  says the calendar stays with its holder: the two roles are independent.
- **Any member takes over, at any time.** Connecting when the trip has a
  calendar is a takeover. The Edge Function makes the new calendar first, then
  `hand_over_calendar` moves the grant to it only if the trip is still on the
  calendar the member saw when they went to Google (carried through the OAuth
  round trip as `replacing`). A member who saw no calendar never takes over
  one made meanwhile, and of two members taking over at once only one wins;
  the loser's new calendar is deleted with their own token. While the
  calendar works, taking over asks for confirmation, since everyone is invited
  again; once it has stopped, the alert offers it directly.
- **The holder connecting again keeps their calendar** when it is found from
  the account they connected (`calendarExists`): only the token is renewed and
  the lapse cleared, so nobody sees duplicates. Otherwise they get a new
  calendar like anyone else. If the old one was known deleted there is nothing
  to ask about; if it simply was not found (they may have picked another
  Google account), they are asked to delete their own old calendar.
- **A new calendar re-queues the trip through the ADR 0006 queue**, not a bulk
  write. A trigger on `calendar_grants.calendar_id` marks every meal written to
  another calendar `pending` (revision + 1) with no event id, and drops meals
  whose decision was cleared and whose event is on the old calendar: there is
  nothing to delete on the new one, and the old one is out of reach. The next
  pass writes them with the usual pacing and backoff.
- **Each new calendar's events get ids of their own.** Event ids are fixed by
  the meal (ADR 0006) so retries find the event they made. Google requires ids
  to be unique per calendar only, but each attendee's copy of an invitation
  keeps the id it was sent with; reusing the old calendar's ids from a
  different organiser risks colliding with those copies in ways Google does
  not document. So the grant carries an `event_suffix` (ten hex digits, fresh
  per calendar) appended to the meal id. Calendars connected before this
  change keep an empty suffix, so their existing events are still found.
- **The previous holder is remembered** (`previous_holder_id`,
  `previous_calendar_id`) and the new holder is told, by name, to ask them to
  delete the old calendar; the previous holder is told to delete it; everyone
  else is told why meals may show twice. The new or previous holder can clear
  the note (`forget_previous_calendar`) once it is done. Only the latest old
  calendar is remembered: a second takeover before the first note is cleared
  replaces it.
- The previous holder, still in the trip, is an ordinary attendee on the new
  calendar's events.

## Considered and not chosen

| Option                                                            | Why not                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reuse the meal's bare id on the new calendar                      | Attendees' copies of the old events carry that id; how Google reconciles an invitation from a new organiser with the same id is undocumented. Distinct ids give the duplicates the PRD accepts, predictably. |
| Take over only once the calendar has lapsed                       | The issue asks that any member can take over, and an organiser handing over their role may want the new organiser to hold the calendar too. A confirmation covers the healthy case.                          |
| Delete the old calendar when the old token still works            | Only possible in the rare healthy handover, and deleting a calendar on someone else's account without them is not the app's call. The same "ask them" note covers every case.                                |
| Mark each waiting meal failed on a dead token (the #12 behaviour) | Buries one cause under many symptoms, and says nothing about the meals already written, which silently stop following changes.                                                                               |
| Keep a lapsed holder's token in case it recovers                  | `invalid_grant` does not recover; a token nobody may use is a secret kept for nothing.                                                                                                                       |

## Consequences

- Participants see duplicate events after a takeover until the old calendar is
  deleted. This is the accepted trade.
- Detection needs someone to open the trip or make a change; a trip nobody
  opens lapses unseen, which matters little since nobody is relying on it
  then. A scheduled sweep (ADR 0006) would close this too.
- The app does not revoke a replaced token with Google. It is discarded from
  the database; the previous holder can revoke access themselves.
- Two takeovers in a row, before the first old calendar is deleted, leave the
  first one unmentioned. Rare enough for one remembered calendar; a list would
  fix it.
