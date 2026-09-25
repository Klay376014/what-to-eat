/*
 * The browser's half of connecting a Google Calendar (#12).
 *
 * This is a second authorisation, separate from signing in (ADR 0001), with
 * its own OAuth client. The member is sent to Google's consent screen and
 * comes back to the app with a one-time code. The code is handed to the
 * calendar Edge Function, which trades it for a refresh token with the
 * client secret. So the browser never holds a token.
 *
 * PKCE ties the code to this tab: only the verifier kept here can redeem it.
 * The state stops a forged return, such as someone else's code planted in a
 * link, from connecting their calendar to this member's trip. Both are kept in
 * sessionStorage across the round trip and used once.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * The narrowest scope that creates a secondary calendar and writes events on
 * it; it cannot see the holder's other calendars. Not a sensitive scope, so
 * the consent screen carries no unverified-app warning (spike #2). Widening
 * it would bring the warning back: check again first. The Edge Function
 * checks a connection was granted exactly this.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

const KEY = "what-to-eat:calendar-connect";
/** Every calendar state starts with this, so a return is told apart from a sign-in. */
const STATE_PREFIX = "calendar-";

interface PendingConnect {
  tripId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
}

/** What came back from Google: a code to redeem, or why there is none. */
export type CalendarReturn =
  | { tripId: string; code: string; codeVerifier: string; redirectUri: string }
  | { tripId: string | null; error: string };

let held: CalendarReturn | null = null;

function storage(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function random(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * Google's consent screen for the trip calendar. Remembers, for this tab,
 * which trip it is for and how to prove the code is this tab's.
 */
export async function consentUrl(
  input: { clientId: string; tripId: string; redirectUri: string },
  win: Window = window,
): Promise<string> {
  const codeVerifier = random(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const state = `${STATE_PREFIX}${random(16)}`;

  const pending: PendingConnect = {
    tripId: input.tripId,
    state,
    codeVerifier,
    redirectUri: input.redirectUri,
  };
  storage(win)?.setItem(KEY, JSON.stringify(pending));

  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    // Offline access with a fresh consent is what makes Google issue the
    // refresh token that lets meals be written while the holder is away.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: "S256",
    state,
  }).toString();
  return url.toString();
}

/** Whether the address's parameters are Google answering a calendar request. */
export function isCalendarReturn(params: Record<string, string>): boolean {
  return params.state?.startsWith(STATE_PREFIX) ?? false;
}

/** The parameters Google adds on the way back, removed from the address bar. */
const RETURN_PARAMS = ["code", "state", "scope", "error", "authuser", "prompt", "hd", "iss"];

/**
 * Reads Google's answer from the address at startup, keeps it for the trip
 * screen, and takes it out of the address bar so a reload does not use the
 * code again. Leaves every other address, a sign-in return included, alone.
 */
export function captureCalendarReturn(win: Window = window): void {
  const { pathname, search, hash } = win.location;
  const params = new URLSearchParams(search);
  const state = params.get("state");
  if (!isCalendarReturn(Object.fromEntries(params))) return;

  let pending: PendingConnect | null = null;
  try {
    const stored = storage(win)?.getItem(KEY);
    pending = stored ? (JSON.parse(stored) as PendingConnect) : null;
    storage(win)?.removeItem(KEY);
  } catch {
    // Unreadable: treated as not asked for.
  }

  const code = params.get("code");
  if (!pending || pending.state !== state) {
    held = {
      tripId: null,
      error: "That answer from Google wasn't for this tab, so nothing was connected. Try again.",
    };
  } else if (code) {
    held = {
      tripId: pending.tripId,
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
    };
  } else {
    held = {
      tripId: pending.tripId,
      error:
        params.get("error") === "access_denied"
          ? "Google Calendar wasn't connected: access was not allowed."
          : "Google Calendar wasn't connected. Try again.",
    };
  }

  for (const name of RETURN_PARAMS) params.delete(name);
  const rest = params.toString();
  win.history.replaceState(win.history.state, "", `${pathname}${rest ? `?${rest}` : ""}${hash}`);
}

/** Google's answer, waiting for the trip screen, if any. */
export function pendingCalendarReturn(): CalendarReturn | null {
  return held;
}

/** Forgets Google's answer, once the trip screen has dealt with it. */
export function clearCalendarReturn(): void {
  held = null;
}
