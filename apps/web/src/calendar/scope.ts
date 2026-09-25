/**
 * The narrowest scope that creates a secondary calendar and writes events on
 * it; it cannot see the holder's other calendars. Not a sensitive scope, so
 * the consent screen carries no unverified-app warning (spike #2). Widening
 * it would bring the warning back: check again first.
 *
 * On its own so the calendar Edge Function, which checks a connection was
 * granted exactly this, imports no browser code (calendarConnect.ts).
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
