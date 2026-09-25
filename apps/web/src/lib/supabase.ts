import { createClient } from "@supabase/supabase-js";
import { isCalendarReturn } from "../calendar/calendarConnect.ts";
import type { Database } from "../types/database.ts";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set (see apps/web/.env.example)",
  );
}

export const supabase = createClient<Database>(url, key, {
  auth: {
    // The OAuth return carries a one-time code rather than tokens in the URL.
    flowType: "pkce",
    // Google's answer to connecting a calendar (#12) comes back to this
    // address too. It is not a sign-in, even when it carries an error, so
    // Supabase leaves it for calendarConnect.ts; otherwise, its own check.
    detectSessionInUrl: (_url, params) =>
      !isCalendarReturn(params) &&
      Boolean(params.access_token || params.error || params.error_description || params.error_code),
  },
});
