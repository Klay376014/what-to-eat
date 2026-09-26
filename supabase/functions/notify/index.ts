// The notify Edge Function (#15; ADR 0009): the daily digests and the
// decision emails, sent through Resend. Two callers:
//
//   the database  pg_cron, once a minute when there is work
//                 (20261001130000_notify_schedule.sql), with the shared secret
//                 in `x-notify-secret`. Runs every pass: digests due, decision
//                 emails waiting, and whatever the outbox has due.
//   a member      the app, straight after deciding, changing or clearing a
//                 meal, signed with their session: `{ "mealId": "..." }`.
//                 Composes and sends that meal's trip's decision emails now
//                 rather than within the minute. It can
//                 only hurry what is already waiting; it composes nothing a
//                 member could choose.
//
// verify_jwt is off (supabase/config.toml): the database's call carries no
// JWT, and the member's is checked here, as in the calendar function.
//
// Secrets (Edge Function secrets, never in the app):
//   RESEND_API_KEY  Resend's API key. Only ever in the Authorization header
//                   of a request to Resend; never logged or returned.
//   NOTIFY_SECRET   the same value as Vault's notify_secret.
//   EMAIL_FROM      optional; "What to eat <notify@mail.ivy-cudgel.com>".
//   APP_URL         optional; "https://klay376014.github.io/what-to-eat/app/".

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../apps/web/src/types/database.ts";
import { decisionPass, deliverPass, digestPass, type NotifyConfig } from "./run.ts";

const DEFAULT_FROM = "What to eat <notify@mail.ivy-cudgel.com>";
const DEFAULT_APP_URL = "https://klay376014.github.io/what-to-eat/app/";

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

const config = (): NotifyConfig => ({
  resend: { apiKey: env("RESEND_API_KEY"), from: Deno.env.get("EMAIL_FROM") || DEFAULT_FROM },
  appUrl: Deno.env.get("APP_URL") || DEFAULT_APP_URL,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Compares two secrets in time that does not depend on where they differ. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}

/**
 * The trip of `mealId`, if the member signing the request is currently in
 * it; otherwise null, whether the meal does not exist or they are not in it.
 */
async function memberTripOfMeal(req: Request, mealId: string): Promise<string | null> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: meal, error: mealError } = await admin
    .from("meals")
    .select("trip_id")
    .eq("id", mealId)
    .maybeSingle();
  if (mealError) throw mealError;
  if (!meal) return null;
  const { data: member, error: memberError } = await admin
    .from("trip_members")
    .select("user_id")
    .eq("trip_id", meal.trip_id)
    .eq("user_id", data.user.id)
    .is("left_at", null)
    .maybeSingle();
  if (memberError) throw memberError;
  return member ? meal.trip_id : null;
}

/** Runs a pass, logging rather than throwing when it fails; null then. */
async function attempt<T>(name: string, pass: () => Promise<T>): Promise<T | null> {
  try {
    return await pass();
  } catch (e) {
    console.error(`notify: ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Not found." }, 404);

  try {
    const secret = req.headers.get("x-notify-secret");
    if (secret !== null) {
      if (!sameSecret(secret, env("NOTIFY_SECRET"))) return json({ error: "Not allowed." }, 401);
      const settings = config();
      // Each pass on its own: one failing does not stop the others.
      const digests = await attempt("digests", () => digestPass(admin, settings, new Date()));
      await attempt("decision emails", () => decisionPass(admin, settings, null));
      const sent = await attempt("delivery", () => deliverPass(admin, settings, null));
      return json({ digests, sent });
    }

    const body = (await req.json().catch(() => ({}))) as { mealId?: unknown };
    if (typeof body.mealId !== "string" || !UUID.test(body.mealId)) {
      return json({ error: "Which meal?" }, 400);
    }
    const tripId = await memberTripOfMeal(req, body.mealId);
    if (!tripId) return json({ error: "You're not in this trip." }, 403);
    const settings = config();
    await decisionPass(admin, settings, tripId);
    const sent = await deliverPass(admin, settings, tripId);
    return json({ sent });
  } catch (e) {
    // Messages from the database or this function's own checks; Resend's
    // answers are recorded per email, with the key struck out.
    console.error(`notify: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "Emails could not be sent just now." }, 500);
  }
});
