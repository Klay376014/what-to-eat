// The calendar Edge Function (#12). Two actions, both for a current member
// of the trip, who signs the request with their session:
//
//   connect  Finishes Google's consent: trades the code for a refresh token,
//            which is kept here and never sent back, creates the trip's
//            secondary calendar on the member's account, and writes every
//            decision waiting for it. When the trip has a calendar already,
//            this is a takeover (#13): the member's new calendar replaces it
//            and every decided meal is written again, there. The holder
//            connecting again keeps their calendar if it is still there.
//   sync     Writes whatever the trip's calendar queue is waiting for. The
//            app asks for this after each decision, change or clear, and
//            when a trip opens; a pass with nothing to write still asks
//            Google for a token, which is how a dead connection is found.
//
// verify_jwt is off (supabase/config.toml): the platform's check only
// understands the legacy JWT keys, so the caller is checked here instead.
//
// Secrets: GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET, of
// the calendar's own OAuth client, never the sign-in one (ADR 0001).

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../apps/web/src/types/database.ts";
import { CALENDAR_SCOPE, Calendar, accessToken, exchangeCode, GoogleError } from "./google.ts";
import { syncTrip } from "./sync.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** A refusal the app shows as it is. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The project's secret key: the new kind when the project has one, else service_role. */
function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    const key = parsed.default ?? Object.values(parsed)[0];
    if (key) return key;
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient<Database>(env("SUPABASE_URL"), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const creds = () => ({
  clientId: env("GOOGLE_CALENDAR_CLIENT_ID"),
  clientSecret: env("GOOGLE_CALENDAR_CLIENT_SECRET"),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in caller, from the session token the app sends. */
async function caller(req: Request): Promise<string> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Refusal(401, "Sign in first.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Refusal(401, "Sign in again.");
  return data.user.id;
}

async function requireMember(tripId: string, userId: string): Promise<void> {
  const { data, error } = await admin
    .from("trip_members")
    .select("user_id")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Refusal(403, "You're not in this trip.");
}

// Calendar creation is one at a time in this instance: Calendar's throttle on
// making calendars is the tightest one it has. Each trip makes at most one.
let creating: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = creating.then(task, task);
  creating = run.catch(() => undefined);
  return run;
}

async function connect(
  tripId: string,
  userId: string,
  body: { code?: unknown; codeVerifier?: unknown; redirectUri?: unknown; replacing?: unknown },
) {
  const { code, codeVerifier, redirectUri, replacing } = body;
  if (
    typeof code !== "string" ||
    typeof codeVerifier !== "string" ||
    typeof redirectUri !== "string" ||
    (replacing !== undefined && replacing !== null && typeof replacing !== "string")
  ) {
    throw new Refusal(400, "The answer from Google was incomplete. Try connecting again.");
  }

  const { data: existing, error: existingError } = await admin
    .from("calendar_grants")
    .select("holder_id, calendar_id")
    .eq("trip_id", tripId)
    .maybeSingle();
  if (existingError) throw existingError;
  // What the member saw when they went to Google must still be the case:
  // connecting where there was no calendar never takes over one made
  // meanwhile, and of two members taking over at once only one does.
  if (existing && !replacing) {
    throw new Refusal(409, "This trip already has a calendar connected.");
  }
  if (existing && existing.calendar_id !== replacing) {
    throw new Refusal(
      409,
      "The trip calendar changed while you were at Google. Look at it again before taking over.",
    );
  }

  const { data: trip, error: tripError } = await admin
    .from("trips")
    .select("name, timezone")
    .eq("id", tripId)
    .single();
  if (tripError) throw tripError;

  const tokens = await exchangeCode({ code, codeVerifier, redirectUri }, creds());
  if (!tokens.scopes.includes(CALENDAR_SCOPE)) {
    throw new Refusal(400, "Google Calendar access wasn't granted. Connect again and allow it.");
  }
  if (!tokens.refreshToken) {
    throw new Refusal(400, "Google didn't grant lasting access. Try connecting again.");
  }

  if (existing?.calendar_id) {
    await takeOver(
      tripId,
      userId,
      existing.holder_id,
      existing.calendar_id,
      tokens.refreshToken,
      trip,
    );
  } else {
    await connectFirst(tripId, userId, tokens.refreshToken, trip);
  }
  return syncTrip(admin, tripId, creds());
}

interface TripNaming {
  name: string;
  timezone: string;
}

/** The trip's first calendar (#12). */
async function connectFirst(
  tripId: string,
  userId: string,
  refreshToken: string,
  trip: TripNaming,
): Promise<void> {
  // Claim the trip's calendar before making it, so two members connecting at
  // once cannot both make one: the second insert meets the primary key.
  const { error: claimError } = await admin
    .from("calendar_grants")
    .insert({ trip_id: tripId, holder_id: userId, refresh_token: refreshToken });
  if (claimError?.code === "23505") {
    throw new Refusal(409, "Someone else connected a calendar for this trip just now.");
  }
  if (claimError) throw claimError;

  let calendar: Calendar | null = null;
  let calendarId: string | null = null;
  try {
    calendar = new Calendar(await accessToken(refreshToken, creds()));
    const made = calendar;
    calendarId = await oneAtATime(() => made.createCalendar(trip.name, trip.timezone));
    const { error } = await admin
      .from("calendar_grants")
      .update({ calendar_id: calendarId })
      .eq("trip_id", tripId);
    if (error) throw error;
  } catch (error) {
    // No calendar, no connection: let someone try again, without leaving an
    // empty calendar behind on the member's account for each attempt.
    if (calendar && calendarId) await calendar.deleteCalendar(calendarId).catch(() => {});
    await admin.from("calendar_grants").delete().eq("trip_id", tripId);
    throw error;
  }
}

/**
 * A calendar for a trip that has one (#13). Its holder connecting again,
 * with the calendar still found from the account they connected, only renews
 * the connection. Anyone else, or a holder whose calendar is not found (it
 * was deleted, or they chose another Google account), gets a new calendar of
 * their own, which replaces the old one if the trip is still on it; the
 * database then queues every decided meal to be written to it.
 */
async function takeOver(
  tripId: string,
  userId: string,
  holderId: string,
  fromCalendarId: string,
  refreshToken: string,
  trip: TripNaming,
): Promise<void> {
  const calendar = new Calendar(await accessToken(refreshToken, creds()));

  if (holderId === userId && (await calendar.calendarExists(fromCalendarId))) {
    const { data, error } = await admin
      .from("calendar_grants")
      .update({ refresh_token: refreshToken, lapsed_at: null, lapse_reason: null })
      .eq("trip_id", tripId)
      .eq("holder_id", userId)
      .eq("calendar_id", fromCalendarId)
      .select("trip_id");
    if (error) throw error;
    if (data.length === 0) throw new Refusal(409, "Someone else took over the calendar just now.");
    return;
  }

  // Made first, and the grant moved to it only if nobody beat us to it: the
  // trip is never without a calendar meanwhile, and a lost race leaves
  // nothing behind on the member's account.
  const calendarId = await oneAtATime(() => calendar.createCalendar(trip.name, trip.timezone));
  let moved = false;
  try {
    const { data, error } = await admin.rpc("hand_over_calendar", {
      trip_id: tripId,
      from_calendar_id: fromCalendarId,
      holder_id: userId,
      refresh_token: refreshToken,
      calendar_id: calendarId,
    });
    if (error) throw error;
    moved = data;
  } finally {
    if (!moved) await calendar.deleteCalendar(calendarId).catch(() => {});
  }
  if (!moved) throw new Refusal(409, "Someone else took over the calendar just now.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const userId = await caller(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tripId = body.tripId;
    if (typeof tripId !== "string" || !UUID.test(tripId)) {
      throw new Refusal(400, "Say which trip.");
    }
    await requireMember(tripId, userId);

    switch (body.action) {
      case "connect":
        return json(await connect(tripId, userId, body));
      case "sync":
        return json(await syncTrip(admin, tripId, creds()));
      default:
        throw new Refusal(400, "Unknown action.");
    }
  } catch (error) {
    if (error instanceof Refusal) return json({ error: error.message }, error.status);
    if (error instanceof GoogleError) return json({ error: error.message }, 502);
    // Never echo the details: they can carry tokens or database internals.
    console.error("calendar function failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "Something went wrong on the server. Try again." }, 500);
  }
});
