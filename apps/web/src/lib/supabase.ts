import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set (see apps/web/.env.example)",
  );
}

export const supabase = createClient<Database>(url, key, {
  // The OAuth return carries a one-time code rather than tokens in the URL.
  auth: { flowType: "pkce" },
});
