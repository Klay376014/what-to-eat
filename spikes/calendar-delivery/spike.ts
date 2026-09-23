// Throwaway spike for #2: prove the calendar delivery path end to end.
// Not app code. Zero dependencies so it runs before the real stack exists.
// Usage and the manual steps around it are in README.md next to this file.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const STATE_FILE = new URL("./.spike-state.json", import.meta.url);

// The narrowest scope that can create a secondary calendar and write events on it.
// It cannot see the user's other calendars, which is what the real app wants too.
const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

const API = "https://www.googleapis.com/calendar/v3";

type State = {
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  calendarId?: string;
  eventId?: string;
};

function loadState(): State {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
}

function saveState(state: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} (see README.md)`);
  return value;
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      ...params,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Token endpoint ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function waitForCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const ok = !error && code && url.searchParams.get("state") === expectedState;
      res
        .writeHead(ok ? 200 : 400, { "Content-Type": "text/plain; charset=utf-8" })
        .end(ok ? "Authorised. You can close this tab." : `Failed: ${error ?? "bad state"}`);
      server.close();
      if (ok) resolve(code);
      else reject(new Error(`Authorisation failed: ${error ?? "state mismatch"}`));
    });
    server.listen(REDIRECT_PORT, "127.0.0.1");
  });
}

async function auth(): Promise<void> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.search = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    // offline + consent is what guarantees a refresh token is issued.
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();

  console.log("Open this URL in a browser signed in as the TEST account (account A):\n");
  console.log(consent.toString());
  console.log("\nScreenshot every screen, especially the unverified-app warning.\n");

  const code = await waitForCode(state);
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });

  const current = loadState();
  saveState({
    ...current,
    refreshToken: (tokens.refresh_token as string | undefined) ?? current.refreshToken,
    accessToken: tokens.access_token as string,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in as number) * 1000,
  });
  console.log(`access token: yes`);
  console.log(`refresh token: ${tokens.refresh_token ? "yes" : "NO — record this as a finding"}`);
  console.log(`granted scope: ${String(tokens.scope)}`);
}

async function refresh(): Promise<void> {
  const state = loadState();
  if (!state.refreshToken) throw new Error("No refresh token stored; run `auth` first");
  const tokens = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
  });
  saveState({
    ...state,
    accessToken: tokens.access_token as string,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in as number) * 1000,
  });
  console.log("Refresh token exchanged for a new access token.");
}

async function accessToken(): Promise<string> {
  const state = loadState();
  if (!state.accessToken || (state.accessTokenExpiresAt ?? 0) < Date.now() + 60_000) {
    await refresh();
    return loadState().accessToken as string;
  }
  return state.accessToken;
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

function requireState<K extends keyof State>(key: K, hint: string): NonNullable<State[K]> {
  const value = loadState()[key];
  if (!value) throw new Error(`No ${key} stored; run \`${hint}\` first`);
  return value as NonNullable<State[K]>;
}

async function createCalendar(): Promise<void> {
  const calendar = (await api("POST", "/calendars", {
    summary: "Spike: Tokyo trip",
    timeZone: "Asia/Tokyo",
  })) as { id: string };
  saveState({ ...loadState(), calendarId: calendar.id });
  console.log(`Secondary calendar created: ${calendar.id}`);
}

// Tomorrow at 19:00 in the calendar's timezone, written as a wall-clock time plus zone
// rather than a UTC instant — the same shape the real app will use.
function tomorrowAt(hour: number): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const date = d.toISOString().slice(0, 10);
  return `${date}T${String(hour).padStart(2, "0")}:00:00`;
}

async function createEvent(attendee: string): Promise<void> {
  const calendarId = requireState("calendarId", "calendar");
  const event = (await api(
    "POST",
    `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      summary: "Dinner: Spike Ramen",
      location: "https://www.google.com/maps/search/?api=1&query=Ichiran+Shibuya",
      description: "Proposed by the spike. Note: bring cash.",
      start: { dateTime: tomorrowAt(19), timeZone: "Asia/Tokyo" },
      end: { dateTime: tomorrowAt(21), timeZone: "Asia/Tokyo" },
      attendees: [{ email: attendee }],
    },
  )) as { id: string; htmlLink: string };
  saveState({ ...loadState(), eventId: event.id });
  console.log(`Event created: ${event.id}\n${event.htmlLink}`);
  console.log(`Now check ${attendee}'s calendar WITHOUT clicking anything in their inbox.`);
}

async function updateEvent(): Promise<void> {
  const calendarId = requireState("calendarId", "calendar");
  const eventId = requireState("eventId", "event <email>");
  await api(
    "PATCH",
    `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
    {
      summary: "Dinner: Spike Sushi (changed)",
      start: { dateTime: tomorrowAt(20), timeZone: "Asia/Tokyo" },
      end: { dateTime: tomorrowAt(22), timeZone: "Asia/Tokyo" },
    },
  );
  console.log(
    "Event updated to Spike Sushi at 20:00. Check for a duplicate in the attendee's calendar.",
  );
}

async function deleteEvent(): Promise<void> {
  const calendarId = requireState("calendarId", "calendar");
  const eventId = requireState("eventId", "event <email>");
  await api(
    "DELETE",
    `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
  );
  saveState({ ...loadState(), eventId: undefined });
  console.log("Event deleted. Check it is gone from the attendee's calendar.");
}

async function cleanup(): Promise<void> {
  const calendarId = requireState("calendarId", "calendar");
  await api("DELETE", `/calendars/${encodeURIComponent(calendarId)}`);
  saveState({ ...loadState(), calendarId: undefined, eventId: undefined });
  console.log("Secondary calendar deleted.");
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  auth,
  refresh,
  calendar: createCalendar,
  event: () => {
    if (!arg) throw new Error("Usage: event <attendee@gmail.com>");
    return createEvent(arg);
  },
  update: updateEvent,
  delete: deleteEvent,
  cleanup,
};

const run = command ? commands[command] : undefined;
if (!run) {
  console.log(`Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
await run();
