// Checks which scopes the hosted project's Google sign-in actually asks for.
//
// Starts a sign-in against Supabase Auth exactly as the app does (no `scopes`
// parameter), stops at the redirect to Google, and reads the `scope` Google
// would be asked for. Fails unless it is within `openid email profile`.
// Why this matters, and where the result is recorded: docs/adr/0001-google-sign-in-scopes.md.
//
// Run from the repo root: `vp run auth:check-scopes`. Reads VITE_SUPABASE_URL
// from the environment or apps/web/.env. Needs no key and signs nobody in.

const ALLOWED = new Set(["openid", "email", "profile"]);

const base = process.env.VITE_SUPABASE_URL;
if (!base) {
  console.error("Set VITE_SUPABASE_URL (see apps/web/.env.example).");
  process.exit(2);
}

const authorize = new URL("/auth/v1/authorize", base);
authorize.searchParams.set("provider", "google");

const response = await fetch(authorize, { redirect: "manual" });
const location = response.headers.get("location");
if (response.status < 300 || response.status >= 400 || !location) {
  console.error(
    `Expected a redirect to Google, got HTTP ${response.status}. ` +
      "Is the Google provider enabled for this project?\n" +
      (await response.text()),
  );
  process.exit(1);
}

const google = new URL(location);
const scopes = (google.searchParams.get("scope") ?? "").split(/[\s+]+/).filter(Boolean);
const extra = scopes.filter((scope) => !ALLOWED.has(scope));

console.log(`Project:   ${new URL(base).host}`);
console.log(`Redirects: ${google.origin}${google.pathname}`);
console.log(`Scopes:    ${scopes.join(" ") || "(none)"}`);

if (google.host !== "accounts.google.com") {
  console.error("Not a redirect to Google's consent screen.");
  process.exit(1);
}
if (extra.length > 0) {
  console.error(`FAIL: sign-in asks for more than openid email profile: ${extra.join(" ")}`);
  process.exit(1);
}
console.log("OK: sign-in requests nothing beyond openid email profile.");
