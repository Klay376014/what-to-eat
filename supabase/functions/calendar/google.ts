// Google's OAuth token endpoint and the Calendar API, as the calendar
// function uses them (#12). The client secret and every token stay here, on
// the server; the browser only ever sees the one-time authorisation code.

import { withBackoff } from "../../../apps/web/src/calendar/backoff.ts";
import type { CalendarEvent } from "../../../apps/web/src/calendar/calendarEvent.ts";

// The scope the app asks for, and so the one a connection must have been granted.
export { CALENDAR_SCOPE } from "../../../apps/web/src/calendar/calendarConnect.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** Google refused, with the status and Google's own reason when it gave one. */
export class GoogleError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

async function googleError(res: Response, what: string): Promise<GoogleError> {
  let detail: string | null = null;
  let reason: string | null = null;
  try {
    const body = (await res.json()) as {
      error?: string | { message?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
    if (typeof body.error === "string") {
      reason = body.error;
      detail = body.error_description ?? body.error;
    } else {
      reason = body.error?.errors?.[0]?.reason ?? null;
      detail = body.error?.message ?? null;
    }
  } catch {
    // No JSON body: the status says enough.
  }
  return new GoogleError(
    res.status,
    `${what}: Google answered ${res.status}${detail ? ` (${detail})` : ""}`,
    reason,
  );
}

async function tokenRequest(
  params: Record<string, string>,
  creds: ClientCredentials,
  what: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      ...params,
    }),
  });
  if (!res.ok) throw await googleError(res, what);
  return (await res.json()) as Record<string, unknown>;
}

/** Trades the authorisation code for a refresh token, and the scopes granted. */
export async function exchangeCode(
  input: { code: string; codeVerifier: string; redirectUri: string },
  creds: ClientCredentials,
): Promise<{ refreshToken: string | null; scopes: string[] }> {
  const tokens = await tokenRequest(
    {
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    },
    creds,
    "Couldn't finish connecting",
  );
  return {
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
    scopes: typeof tokens.scope === "string" ? tokens.scope.split(" ") : [],
  };
}

/** A fresh access token from the stored refresh token. */
export async function accessToken(refreshToken: string, creds: ClientCredentials): Promise<string> {
  const tokens = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    creds,
    "The calendar connection stopped working",
  );
  return tokens.access_token as string;
}

/** The Calendar API as one holder's access token reaches it. */
export class Calendar {
  constructor(private readonly token: string) {}

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return withBackoff(() =>
      fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  /** Makes the trip's secondary calendar; returns its id. */
  async createCalendar(summary: string, timeZone: string): Promise<string> {
    const res = await this.request("POST", "/calendars", { summary, timeZone });
    if (!res.ok) throw await googleError(res, "Couldn't create the trip calendar");
    return ((await res.json()) as { id: string }).id;
  }

  /** Deletes a calendar the app made. */
  async deleteCalendar(calendarId: string): Promise<void> {
    const res = await this.request("DELETE", `/calendars/${encodeURIComponent(calendarId)}`);
    if (!res.ok && res.status !== 404) throw await googleError(res, "Couldn't delete the calendar");
  }

  /**
   * Writes the event, telling the attendees. Its id is fixed by the meal
   * (calendarEvent.ts), so this updates the event when one exists, even one
   * deleted earlier, and makes it otherwise: never a second one.
   */
  async putEvent(calendarId: string, event: CalendarEvent): Promise<string> {
    const events = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const update = () =>
      this.request("PUT", `${events}/${event.id}?sendUpdates=all`, {
        ...event,
        status: "confirmed",
      });

    let res = await update();
    if (res.status === 404) {
      res = await this.request("POST", `${events}?sendUpdates=all`, event);
      // Made meanwhile by another pass: update that one.
      if (res.status === 409) res = await update();
    }
    if (!res.ok) throw await googleError(res, "Couldn't write the event");
    return event.id;
  }

  /** Deletes the event, telling the attendees. One already gone is fine. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const res = await this.request(
      "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw await googleError(res, "Couldn't delete the event");
    }
  }
}
