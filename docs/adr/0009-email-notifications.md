# Emails go through an outbox in the database, sent by Resend on a pg_cron schedule

Status: accepted (#15)

## Context

#15 sends two kinds of email: a daily digest per trip at 08:00 on the trip's
own clock, and an immediate email when a meal is decided, changed or
cleared. #16 (the nudge) will send a third. Supabase's own email is for
sign-in only, so a transactional provider is needed, called from an Edge
Function so its API key never reaches a browser.

Three properties matter more than any others:

- **A retried job does not send twice.** Edge Functions time out, networks
  drop answers, and two passes can overlap.
- **The digest goes out without anyone opening the app.** That is its whole
  point: it brings people back.
- **Departed members stop hearing about the trip**, and a member who opted
  out of calendar invitations (#14) still gets the app's email.

## Decision

**The database decides what is owed and records what was sent; the notify
Edge Function composes and sends through Resend; pg_cron asks it to, every
minute.** See `supabase/migrations/20261001120000_email_notifications.sql`,
`20261001130000_notify_schedule.sql`, `supabase/functions/notify/` and
`apps/web/src/notifications/`.

- **Decision notices.** A trigger on `decisions` records every change in
  `decision_notices` with the restaurant before and after, and who made it.
  A pass takes a meal's waiting notices together (all or none; a meal with a
  notice still held by another or a failed pass waits, so its emails are
  never composed out of order) and sends one email for where they ended up
  (`netDecisionChange`): changes that piled up before a pass took them are
  one email, and a decision undone before it was sent is none. Because the
  app asks for a pass straight after each change, most changes are taken
  alone and each is its own email; merging is what happens when the app's
  call did not get through, or changes land while a pass is running. The
  person who made the last change is not emailed.
- **Digest runs.** `digest_runs` has one row per trip per local day. A pass
  works out which trips are due (08:00 passed on the trip's clock, no run
  for that day, trip not ended: `dueDigestDay`), composes each member's
  digest from the proposals made since the previous run's cut-off (a trip's
  first digest looks back only 24 hours, `FIRST_DIGEST_LOOKBACK_MS`, so a
  trip planned for weeks before this shipped is not sent weeks of old
  proposals as new), and
  records the day and its emails in one call (`record_digest`). Only the
  first pass to record a day does; a day with nothing new is still recorded,
  with no emails. The cut-off is 30 seconds before the pass, so a proposal
  being written as the digest is read waits for tomorrow's rather than
  falling between two.
- **The outbox.** `email_outbox` holds one row per email to one member,
  under a key fixed by what the email is for (`digest:<trip>:<day>:<member>`,
  `decision:<last notice>:<member>`), unique in the table. A pass that
  crashes after composing composes the same keys again and adds nothing.
  Sending claims rows for five minutes; each send carries the key as
  Resend's `Idempotency-Key`, which Resend honours for 24 hours, so a send
  whose answer was lost and is repeated is still one email. Retries back
  off 1, 2, 4, 8, 16 minutes and stop after six tries, well inside that
  window. The nudge (#16) adds its own kind and keys to the same outbox and
  reuses `deliverPass` and `sendEmail`.
- **Recipients** are the trip's current members by the address on their
  account (`trip_contacts`), never `calendar_attendees()`. The outbox
  refuses rows for someone not currently in the trip, and a row waiting for
  someone who has since left is cancelled when it would be sent.
- **Scheduling.** pg_cron runs `private.kick_notify()` every minute. It
  calls the function (pg_net, after commit) only when there is work: an
  email due, a notice waiting, or a trip past 08:00 locally with no run for
  the day. The function's URL and a shared secret live in Vault; the secret
  goes in an `x-notify-secret` header the function compares in constant
  time. Until both are in Vault, the schedule does nothing, which is also
  the case locally and in CI. Every minute (not hourly) because some zones
  are a quarter or half hour off the hour, and because decision emails ride
  on the same schedule.
- **The app also asks.** After deciding, changing or clearing, the app
  calls `notify` with the meal, signed as the member; the function checks
  they are in the meal's trip and runs the decision and delivery passes for
  that trip. This can only hurry what the database already has waiting.
- **Resend,** through its REST API with `fetch`: a free tier that covers a
  few trips of up to eight (3,000 a month, 100 a day), a Deno-friendly
  plain HTTP API, and the idempotency key, which no other free option
  examined offers. Sending is from `mail.ivy-cudgel.com`, a subdomain, so
  its reputation and DNS records are kept apart from the root domain's.

## Reversing part of ADR 0006

ADR 0006 chose not to use pg_cron + pg_net for the calendar, because it
"needs the function's URL and a secret key stored in the database, and more
setup on the hosted project", and the app's own call covered the normal case.

For email the app's call does not cover the normal case. The digest has to
go out at 08:00 whether or not anyone has the app open; that is the only
reason it exists. So the setup ADR 0006 avoided is now worth it:

- the URL and secret are kept in Vault, not in a migration or a table, and
  the secret opens only this function, never the database;
- the setup is one documented step after `db push` (README, "Email").

The calendar keeps ADR 0006's design. The same schedule could now carry the
"scheduled sweep" ADR 0006 left for later, without changing its queue.

## Considered and not chosen

| Option                                             | Why not                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Actions cron calling the function           | Scheduled workflows run late, often 5 to 30 minutes, are sometimes dropped, and stop after 60 days without repository activity. The issue asks for scheduling in the database. |
| One pg_cron job per trip at its 08:00              | A job's time is fixed in UTC, so a timezone change or DST would need the job rewritten. Checking every minute is cheap and follows the clocks by itself.                       |
| Send from inside the database with pg_net only     | The API key would sit in the database, and composing an email in SQL would duplicate the rendering the app's tests cover.                                                      |
| Postmark, Brevo, SendGrid                          | Postmark's free tier is about 100 emails a month; Brevo and Postmark have no idempotency key; SendGrid's free plan is gone.                                                    |
| Waiting a minute after a change before emailing it | Would merge a quick correction into one email, but delay every decision email; the issue asks for them immediately, and a correction a minute later is itself worth telling.   |
| Merging a member's digests across trips            | The subject line must name the trip, and one email would have to pick one trip's morning.                                                                                      |

## Consequences

- A paused free-tier project runs no cron. The keepalive (#2) prevents the
  pause; if it fails and the project pauses, the app and its emails stop
  together until it is restored. Digests for days that ended meanwhile are
  not sent late; the next one covers everything since the last.
- A decision email reaches members within a minute even if the member who
  decided closes the tab at once; the app's own call usually makes it
  seconds.
- A refusal from Resend (a 4xx other than 429, such as an unverified domain
  or a bad key) fails the email for good; the error is kept on the outbox
  row. Emails composed while the key was wrong are not resent after it is
  fixed.
- Most minutes nothing leaves the database; `kick_notify` itself is a few
  index lookups. Edge Function invocations stay far below the free tier.
- `email_outbox` keeps every email sent, with its content, for good. At a
  few trips of up to eight people this is small; pruning old rows can be
  added when it matters.
