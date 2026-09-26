# A nudge is a row the database only lets in once per meal every six hours

Status: accepted (#16)

## Context

When the discussion on one meal stalls, any member can nudge: email the
members who have not voted on it. Two things make a nudge worth sending,
and both break easily:

- **It reaches only the people it is about.** Someone who already voted and
  is asked again learns to ignore the app's email.
- **It is rare.** Once per meal every six hours (the PRD, #1, story 73). A
  button that can be pressed repeatedly is noise, and a cooldown kept only
  in the browser is one a second tab, a reload or a direct API call walks
  past.

The emails themselves are a solved problem: #15's outbox, notify Edge
Function and schedule ([ADR 0009](0009-email-notifications.md)) were built
for a third kind of email.

## Decision

See `supabase/migrations/20261002090000_nudges.sql`,
`supabase/functions/notify/run.ts` (`nudgePass`),
`apps/web/src/notifications/` (`nudgeRecipients`, `nudgeEmail`,
`composeNudgeEmails`) and `apps/web/src/proposals/` (`nudge.ts`,
`MealNudge.vue`).

- **The cooldown lives in the database.** `meal_nudges` has one row per
  nudge. Members can read who nudged which meal when (the button needs it)
  but hold no write grant; the only way in is `public.nudge_meal(meal_id)`,
  a security-definer function that takes the meal's row lock
  (`FOR NO KEY UPDATE`, so votes and proposals on the meal are not blocked),
  reads the meal's latest nudge, and refuses when it is less than six hours
  old. Two members pressing at once take turns on the lock, so one of them
  gets `nudge_cooldown`, with the moment it can next be nudged as the
  error's detail. The six hours are set once, in `private.nudge_cooldown()`.
- **The boundary is inclusive.** Exactly six hours after the last nudge a
  meal can be nudged again. The database (`last > now() - 6h` refuses) and
  the button (`nudgeCooldownLeft`) agree, and both are tested at the
  boundary.
- **What cannot be nudged is refused too.** `nudge_meal` also refuses a
  decided meal (`meal_decided`), a meal with no proposals
  (`nothing_to_vote_on`) and a meal where every current member but the
  caller has voted (`everyone_voted`), so a nudge that would reach nobody
  never starts a cooldown. A departed member never counts as someone to
  nudge. Someone not in the trip gets 42501, as elsewhere.
- **Recipients are worked out when the emails are composed**, not when the
  button is pressed: `nudgeRecipients` takes the trip's contacts
  (`trip_contacts`, never `calendar_attendees()`), leaves out those who
  left, the nudger and those without an address, and keeps those with no
  vote on any of the meal's proposals. A member who votes in the seconds
  between the press and the pass is not emailed; a meal decided in between
  sends nothing.
- **Through #15's outbox.** A nudge is claimed (five-minute hold) and its
  emails recorded with it in one call (`record_nudge_emails`), under the key
  `nudge:<nudge id>:<member>`, which is also Resend's Idempotency-Key. The
  app asks `notify` straight after nudging (`{ mealId }`, as after a
  decision), and the schedule counts a waiting nudge as work, so it is sent
  within the minute even if that call is lost. Processed nudges are deleted
  with the other email records after 30 days; a cooldown only ever looks
  back six hours.
- **The button reflects it.** It names who has not voted, and during the
  cooldown says "Nudge again in 4 h 15 min" (counting down while the meal
  is open) with a line on why. It is not shown on a decided meal or one with
  nothing proposed; where everyone else has voted it says so instead. If the
  database refuses because someone else nudged meanwhile, the button takes
  the cooldown from the refusal.

## Considered and not chosen

| Option                                                  | Why not                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cooldown per member (each member once per meal / 6 h) | The rarity is what the recipients experience; with eight members a meal could be nudged eight times in an afternoon.                                                    |
| An exclusion constraint on nudge time ranges            | Expresses "no two nudges within six hours" declaratively, but needs `btree_gist` and cannot also refuse decided or fully voted meals; the function has to exist anyway. |
| Nudging decided meals                                   | Nobody's vote changes a decided meal; a nudge would ask for something that no longer matters. Changing a decision is its own email (#15).                               |
| Nudging a meal with no proposals ("come propose")       | The nudge asks for votes, and there is nothing to vote on; the email would have no restaurant to show. The daily digest already lists meals awaiting a vote.            |
| Recipients fixed when the button is pressed             | Would email someone who voted a moment later. Composing at the pass is seconds later and uses the same state the digest does.                                           |

## Consequences

- A nudge refused for any reason leaves nothing behind and starts no
  cooldown.
- The button's cooldown uses the device's clock against the server's
  timestamp. A device clock that is off shows the wrong time left (never
  more than six hours); the server still decides, and a refusal corrects
  the button.
- Who nudged a meal, and when, is visible to the trip's members.
