# Findings: calendar delivery spike (#2)

Date:
Account A (organiser) type: personal Gmail / Workspace
Account B (attendee) type: personal Gmail / Workspace
Scope requested: `https://www.googleapis.com/auth/calendar.app.created`
App publishing status: In production, unverified

## Results

| #   | Check                                                          | Result | Notes                 |
| --- | -------------------------------------------------------------- | ------ | --------------------- |
| 1   | OAuth client can request the Calendar scope, app in production |        |                       |
| 2   | `auth` returns access token **and** refresh token              |        |                       |
| 3   | `refresh` exchanges the refresh token successfully             |        |                       |
| 4   | `calendar` creates a secondary calendar                        |        |                       |
| 5   | `event` creates an event with account B as attendee            |        |                       |
| 6   | Event appears in B's calendar **without B clicking anything**  |        | How long did it take? |
| 7   | `update` changes B's copy — no duplicate                       |        |                       |
| 8   | `delete` removes it from B's calendar                          |        |                       |

## Unverified-app warning

What account A saw, step by step (attach screenshots):

1.
2.

Was there a "user cap" message or any hard block, or only the "Advanced → Go to (unsafe)" path?

## Anything that did not work, or surprised you

-

## Verdict

- [ ] Path works — #11–#13 proceed as designed
- [ ] Path fails — #11–#13 need redesign around in-app view + email (note posted on #1)
