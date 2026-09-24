import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vite-plus/test";
import { googleSignInUrl } from "./auth.ts";

// A real client pointed at an address nothing listens on: building the
// sign-in URL is local, and the URL is exactly where the browser would go.
const client = createClient("https://project.supabase.test", "publishable-key", {
  auth: { persistSession: false },
});

test("sign-in goes to Supabase Auth's Google provider and comes back to the app", async () => {
  const url = new URL(await googleSignInUrl(client, "https://app.test/"));

  expect(url.origin + url.pathname).toBe("https://project.supabase.test/auth/v1/authorize");
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toBe("https://app.test/");
});

// Supabase Auth asks Google for `email profile` and appends whatever the
// client passes as `scopes`. Any extra scope here would make it a sensitive
// request: Google's verification review, the unverified-app warning and the
// 100-user cap. See docs/adr/0001-google-sign-in-scopes.md.
test("sign-in asks Google for nothing beyond the provider's default scopes", async () => {
  const url = new URL(await googleSignInUrl(client, "https://app.test/"));

  expect(url.searchParams.has("scopes")).toBe(false);
  // Nor anything else passed through to Google, such as a `prompt` or an
  // `access_type=offline` that would ask for a refresh token.
  const known = ["provider", "redirect_to", "code_challenge", "code_challenge_method"];
  expect([...url.searchParams.keys()].filter((key) => !known.includes(key))).toEqual([]);
});
