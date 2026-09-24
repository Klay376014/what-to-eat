# Sign-in with Google requests only `openid email profile`

Status: accepted (#5)

## Context

Sign-in is Google only, through Supabase Auth. `openid`, `email` and `profile`
are Google's non-sensitive scopes. As long as the sign-in client asks for
nothing else, Google requires no verification review, shows no "Google hasn't
verified this app" warning, and applies no 100-user cap. One sensitive scope on
this client, such as any Calendar scope, would bring back all three for every
user.

Calendar access is a separate authorisation with its own OAuth client. It is
asked only of the one member who takes on calendar duty (#1, "Identity and
authorisation").

## Decision

The sign-in client requests `openid email profile` and nothing more. This is
kept true in three places:

1. **Supabase Auth.** The Google provider asks for `email` and `profile`, then
   appends whatever the client sends in the `scopes` parameter. See
   `NewGoogleProvider` in
   [`internal/api/provider/google.go`](https://github.com/supabase/auth/blob/5e372a96c05b001871f41260b2f35bdefc5d68fb/internal/api/provider/google.go#L49-L56)
   (read at commit `5e372a9`, 2026-09-02). Neither `config.toml` nor the
   dashboard has a setting that adds more.
2. **The app.** `apps/web/src/auth/auth.ts` calls `signInWithOAuth` with no
   `scopes` and no pass-through `queryParams`. `auth.test.ts` builds the real
   sign-in URL and fails if either appears.
3. **Google Cloud.** The OAuth consent screen's Data Access page for the
   sign-in client lists only `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`.

## Verification

`vp run auth:check-scopes` starts a sign-in against the hosted project the way
the app does, stops at the redirect to Google, and fails if the `scope` it
would request contains anything outside `openid email profile`.

| Date       | Checked by | What                                                                        | Result                                                                                            |
| ---------- | ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2026-09-24 | agent (#5) | Supabase Auth source, `google.go` at `5e372a9`                              | Default scopes are `email profile`; extras come only from the client's `scopes`                   |
| 2026-09-24 | agent (#5) | App sign-in URL (`auth.test.ts`)                                            | No `scopes` and no other pass-through parameter                                                   |
| 2026-09-24 | agent (#5) | `vp run auth:check-scopes` against the hosted project                       | Not run: the Google provider is not enabled on the hosted project yet (`provider is not enabled`) |
| 2026-09-24 | agent (#5) | `vp run auth:check-scopes` against the hosted project, provider now enabled | Redirects to `accounts.google.com` with `scope=email profile`: OK                                 |
| TODO       | maintainer | The consent screen's Data Access list in Google Cloud                       |                                                                                                   |

Run the check again, and add a row, whenever the Google provider, its OAuth
client or the consent screen changes.

## Consequences

- Anything that needs more of Google, Calendar above all, gets its own OAuth
  client and flow. It never adds a scope to this one.
- The check is not automatic in CI: it needs the hosted project and a real
  Google client. `auth.test.ts` guards the app's half on every run.
