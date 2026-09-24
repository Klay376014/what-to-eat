import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { onScopeDispose, ref, type Ref } from "vue";

/**
 * Where the browser goes to sign in with Google.
 *
 * Deliberately passes no `scopes`: Supabase Auth then asks Google for its
 * default `email profile` only, which are non-sensitive. Adding a scope here
 * (Calendar above all) would put the app through Google's verification
 * review, show every user the unverified-app warning and cap it at 100
 * users. Calendar access is a separate authorisation.
 * See docs/adr/0001-google-sign-in-scopes.md.
 */
export async function googleSignInUrl(client: SupabaseClient, redirectTo: string): Promise<string> {
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  return data.url;
}

export async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  const url = await googleSignInUrl(client, window.location.origin + window.location.pathname);
  window.location.assign(url);
}

export async function signOut(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export interface SessionState {
  /** False until the stored session (or the OAuth return) has been read. */
  ready: Ref<boolean>;
  session: Ref<Session | null>;
}

/** The current session, kept up to date for as long as the caller lives. */
export function useSession(client: SupabaseClient): SessionState {
  const ready = ref(false);
  const session = ref<Session | null>(null);

  const { data } = client.auth.onAuthStateChange((_event, next) => {
    session.value = next;
    ready.value = true;
  });
  onScopeDispose(() => data.subscription.unsubscribe());

  return { ready, session };
}
