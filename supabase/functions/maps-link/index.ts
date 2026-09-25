// The maps-link Edge Function (#9): what a pasted Maps short link points at.
//
// POST { url } from a signed-in member, answered with { place } (the name,
// CID and coordinates) or { place: null } when the link could not be
// resolved. See docs/adr/0007-maps-link-resolution.md.
//
// - Each link is resolved once. What it resolved to, or Google's answer that
//   it has no place (a redirect to something that is not a place, or a
//   404), is kept in public.maps_links for good, and a proposal made with
//   the link takes its CID and coordinates from there.
// - Only https://maps.app.goo.gl/<id> is ever asked (shortLink), so the
//   function cannot be pointed anywhere else.
// - The request carries no User-Agent and nothing follows the redirect: a
//   browser User-Agent is served a JavaScript page with no Location, and
//   fetch() always sends one of its own, so the request is written by hand
//   over TLS (redirectRequest) and only the reply's head is read.
// - No answer (a timeout, a failed connection, a 429 or 5xx, anything but a
//   redirect or a 404) is not kept: a later paste of the link asks again.
//   Nothing is retried within a request.
// - Either way the app is told only "no place", and leaves the name to the
//   member.
//
// verify_jwt is off (supabase/config.toml), as for the calendar function:
// the platform's check only understands the legacy JWT keys, so the caller
// is checked here instead.

import { createClient } from "@supabase/supabase-js";
import {
  parsePlaceUrl,
  shortLink,
  type ResolvedPlace,
} from "../../../apps/web/src/proposals/mapsLink.ts";
import type { Database } from "../../../apps/web/src/types/database.ts";
import { askWhereItPoints } from "./redirect.ts";

/** Postgres unique_violation: someone resolved the same link just now. */
const UNIQUE_VIOLATION = "23505";

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

/** Whether the request carries a live session: only members' app asks. */
async function signedIn(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  return !error && data.user !== null;
}

type Row = Pick<
  Database["public"]["Tables"]["maps_links"]["Row"],
  "place_name" | "place_cid" | "lat" | "lng"
>;

function placeOf(row: Row): ResolvedPlace | null {
  if (row.place_name === null || row.place_cid === null || row.lat === null || row.lng === null) {
    return null;
  }
  return { placeName: row.place_name, placeCid: row.place_cid, lat: row.lat, lng: row.lng };
}

async function resolve(sourceUrl: string, link: URL): Promise<ResolvedPlace | null> {
  const { data: cached, error: cacheError } = await admin
    .from("maps_links")
    .select("place_name, place_cid, lat, lng")
    .eq("source_url", sourceUrl)
    .maybeSingle();
  if (cacheError) throw cacheError;
  if (cached) return placeOf(cached);

  const reply = await askWhereItPoints(link);
  // No answer this time: nothing is kept, so the link can be asked again.
  if (reply === "unavailable") return null;
  const place = reply === "no place" ? null : parsePlaceUrl(reply.location);

  const { error } = await admin.from("maps_links").insert({
    source_url: sourceUrl,
    place_name: place?.placeName ?? null,
    place_cid: place?.placeCid ?? null,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
  });
  // Someone resolved it at the same moment: theirs is kept, and says the same.
  if (error && error.code !== UNIQUE_VIOLATION) throw error;
  return place;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    if (!(await signedIn(req))) return json({ error: "Sign in first." }, 401);
    const body = (await req.json().catch(() => ({}))) as { url?: unknown };
    // Kept as pasted (trimmed), the way the proposal will store it, so the
    // proposal finds this resolution by its link.
    const sourceUrl = typeof body.url === "string" ? body.url.trim() : "";
    const link = shortLink(sourceUrl);
    if (!link || sourceUrl.length > 2000) {
      return json({ error: "Only Google Maps short links are looked up." }, 400);
    }
    return json({ place: await resolve(sourceUrl, link) });
  } catch (error) {
    // Never echo the details: they can carry database internals.
    console.error("maps-link function failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "Something went wrong on the server." }, 500);
  }
});
