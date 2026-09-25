// The calendar Edge Function (#12). Two actions, both for a current member
// of the trip, who signs the request with their session:
//
//   connect  Finishes Google's consent: trades the code for a refresh token,
//            which is kept here and never sent back, creates the trip's
//            secondary calendar on the member's account, and writes every
//            decision waiting for it.
//   sync     Writes whatever the trip's calendar queue is waiting for. The
//            app asks for this after each decision, change or clear, and
//            when a trip opens with meals still waiting.
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
  body: { code?: unknown; codeVerifier?: unknown; redirectUri?: unknown },
) {
  const { code, codeVerifier, redirectUri } = body;
  if (
    typeof code !== "string" ||
    typeof codeVerifier !== "string" ||
    typeof redirectUri !== "string"
  ) {
    throw new Refusal(400, "The answer from Google was incomplete. Try connecting again.");
  }

  const { data: existing, error: existingError } = await admin
    .from("calendar_grants")
    .select("holder_id")
    .eq("trip_id", tripId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw new Refusal(409, "This trip already has a calendar connected.");

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

  // Claim the trip's calendar before making it, so two members connecting at
  // once cannot both make one: the second insert meets the primary key.
  const { error: claimError } = await admin
    .from("calendar_grants")
    .insert({ trip_id: tripId, holder_id: userId, refresh_token: tokens.refreshToken });
  if (claimError?.code === "23505") {
    throw new Refusal(409, "Someone else connected a calendar for this trip just now.");
  }
  if (claimError) throw claimError;

  let calendar: Calendar | null = null;
  let calendarId: string | null = null;
  try {
    calendar = new Calendar(await accessToken(tokens.refreshToken, creds()));
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

  return syncTrip(admin, tripId, creds());
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
