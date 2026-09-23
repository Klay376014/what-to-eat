# Spike: calendar delivery path (#2)

Throwaway. Proves, or disproves, the mechanism the whole calendar design rests on:
an **unverified** app creates a **secondary** calendar on account A, and adds a
**different, external** Gmail address (account B) as an **attendee** — so the event
appears in B's calendar without B doing anything.

The script (`spike.ts`) does the API calls. What only a human can do is set up the
Google Cloud side, look at account B's calendar, and take screenshots.

## You need

- **Account A** — a personal Gmail that plays the organiser. Not a Workspace account:
  the real users are on personal Gmail, and Workspace behaves differently.
- **Account B** — a second, real, personal Gmail, ideally one that has never
  interacted with account A. This is the one whose calendar you check.

## 1. Google Cloud setup (≈15 min)

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project, e.g. `what-to-eat-spike`.
2. APIs & Services → Library → enable **Google Calendar API**.
3. Google Auth Platform → Branding / Audience: user type **External**.
4. Data Access → add scope `https://www.googleapis.com/auth/calendar.app.created`.
5. Audience → **Publish app** so it is in **In production** status. Do not submit for
   verification — the point is to see what an unverified production app gets.
6. Clients → Create client → **Web application**, authorised redirect URI
   `http://127.0.0.1:8765/callback`. Copy the client ID and secret.

## 2. Run the path

Node ≥ 22.6. From the repo root:

```sh
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
S="node --experimental-strip-types spikes/calendar-delivery/spike.ts"

$S auth                        # open the URL as account A; screenshot every screen
$S refresh                     # proves the refresh token actually works
$S calendar                    # creates the secondary calendar "Spike: Tokyo trip"
$S event accountB@gmail.com    # now look at account B's calendar — do NOT click the email
$S update                      # rename + move to 20:00; look for a duplicate in B
$S delete                      # look that it is gone from B
$S cleanup                     # deletes the secondary calendar
```

Tokens and ids are kept in `.spike-state.json` beside the script, which is
gitignored. Delete it when done, and revoke the grant at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## 3. Record the results

Fill in `FINDINGS.md`, then paste it as a comment on #2. If the path fails,
also comment on #1 that #11–#13 need redesign, and why.
