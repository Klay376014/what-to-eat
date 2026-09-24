<script setup lang="ts">
import { computed, provide, ref } from "vue";
import AccountMenu, { type AccountUser } from "./account/AccountMenu.vue";
import { signInWithGoogle, signOut, useSession } from "./auth/auth.ts";
import SignIn from "./auth/SignIn.vue";
import { createSupabaseMealsApi, mealsApiKey } from "./grid/mealsApi.ts";
import { errorMessage } from "./lib/errors.ts";
import { supabase } from "./lib/supabase.ts";
import { createSupabaseProposalsApi, proposalsApiKey } from "./proposals/proposalsApi.ts";
import { createSupabaseTripsApi, tripsApiKey } from "./trips/tripsApi.ts";
import TripsHome from "./trips/TripsHome.vue";
// #6: invitation links and membership.
import InvitationGate from "./invitations/InvitationGate.vue";
import { createSupabaseMembershipApi, membershipApiKey } from "./invitations/membershipApi.ts";
import { clearPendingInvite, pendingInvite } from "./invitations/pendingInvite.ts";
import BaseButton from "./ui/BaseButton.vue";
import BaseCard from "./ui/BaseCard.vue";

provide(tripsApiKey, createSupabaseTripsApi(supabase));
provide(mealsApiKey, createSupabaseMealsApi(supabase));
provide(proposalsApiKey, createSupabaseProposalsApi(supabase));
provide(membershipApiKey, createSupabaseMembershipApi(supabase));

// #6: an invitation captured from the address at startup (main.ts). Used
// once: after it is spent, a later sign-in as someone else must not reuse it.
const inviteToken = ref(pendingInvite());
function inviteSettled() {
  inviteToken.value = null;
  clearPendingInvite();
}

const { ready, session } = useSession(supabase);

// The same Google name and picture the profiles row is filled from at
// sign-in (supabase/migrations/..._profiles.sql), read from the session so
// the header needs no extra request.
const user = computed<AccountUser | null>(() => {
  const account = session.value?.user;
  if (!account) return null;
  const meta = account.user_metadata ?? {};
  const email = account.email ?? "";
  const picture = (meta.avatar_url ?? meta.picture ?? null) as string | null;
  return {
    name: (meta.full_name ?? meta.name ?? email) as string,
    email,
    avatarUrl: picture?.startsWith("https://") ? picture : null,
  };
});

const signIn = () => signInWithGoogle(supabase);
const signInFailure = ref<string | null>(null);

async function signInFromHeader() {
  signInFailure.value = null;
  try {
    await signIn();
  } catch (error) {
    signInFailure.value = `Couldn't start signing in: ${errorMessage(error)}`;
  }
}
const leave = () => signOut(supabase);
</script>

<template>
  <!-- A solid bar: text never sits on the textured backdrop (ADR 0002). -->
  <header class="app-header">
    <div class="app-header-inner">
      <span class="app-name">今天吃什麼</span>
      <template v-if="ready">
        <AccountMenu v-if="user" :user="user" :sign-out="leave" />
        <BaseButton v-else variant="primary" @click="signInFromHeader">Sign in</BaseButton>
      </template>
    </div>
  </header>

  <main class="page stack">
    <BaseCard v-if="signInFailure"
      ><p role="alert" class="error">{{ signInFailure }}</p></BaseCard
    >
    <BaseCard v-if="!ready"><p class="muted">Loading…</p></BaseCard>

    <SignIn v-else-if="!session" :sign-in="signIn" :invited="inviteToken !== null" />

    <!-- Keyed on the user so switching accounts starts from a clean slate. -->
    <InvitationGate
      v-else
      :key="session.user.id"
      v-slot="{ openTripId }"
      :token="inviteToken"
      @settled="inviteSettled"
    >
      <TripsHome :open-trip-id="openTripId" />
    </InvitationGate>
  </main>
</template>

<style scoped>
/* A solid bar: text never sits on the textured backdrop (ADR 0002). */
.app-header {
  background: var(--surface);
  border-bottom: var(--border-width) solid var(--border-strong);
}

.app-header-inner,
.page {
  max-width: 40rem;
  margin: 0 auto;
}

.app-header-inner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 56px;
  padding: var(--space-1) var(--space-4);
}

.app-name {
  font-family: var(--font-heading);
  font-weight: var(--heading-weight);
  font-size: var(--text-lg);
  margin-right: auto;
}

.page {
  padding: var(--space-4) var(--space-4) calc(var(--space-6) * 2);
}
</style>
