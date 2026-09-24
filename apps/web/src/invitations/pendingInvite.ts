import { locationWithoutInvite, readInviteToken } from "./invitation.ts";

/**
 * Carries an invitation across the Google sign-in round trip.
 *
 * Sign-in leaves the app and comes back to its bare address (auth.ts sends
 * `origin + pathname` as the redirect), so `?invite=` would be lost on the
 * way. At startup the token is copied into sessionStorage, which survives
 * that round trip in the same tab and ends with it, and then taken out of the
 * address bar, so a reload does not try to join again and the token is not
 * left on screen. If storage is unavailable the token is still held in
 * memory, which covers someone who is already signed in.
 */

const KEY = "what-to-eat:pending-invite";
let held: string | null = null;

function storage(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

/** Reads `?invite=` from the address, keeps it, and removes it from the bar. */
export function capturePendingInvite(win: Window = window): void {
  const { pathname, search, hash } = win.location;
  const token = readInviteToken(search);
  if (token === null) return;

  held = token;
  try {
    storage(win)?.setItem(KEY, token);
  } catch {
    // Full or blocked storage: the in-memory copy still covers this page.
  }
  win.history.replaceState(win.history.state, "", locationWithoutInvite(pathname, search, hash));
}

/** The invitation waiting to be used, if any. */
export function pendingInvite(win: Window = window): string | null {
  if (held !== null) return held;
  try {
    return storage(win)?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

/** Forgets the invitation, once it has been used or refused. */
export function clearPendingInvite(win: Window = window): void {
  held = null;
  try {
    storage(win)?.removeItem(KEY);
  } catch {
    // Nothing stored, then.
  }
}
