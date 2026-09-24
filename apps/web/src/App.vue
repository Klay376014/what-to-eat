<script setup lang="ts">
import { computed, provide, ref } from "vue";
import { signInWithGoogle, signOut, useSession } from "./auth/auth.ts";
import SignIn from "./auth/SignIn.vue";
import { errorMessage } from "./lib/errors.ts";
import { supabase } from "./lib/supabase.ts";
import { createSupabaseTripsApi, tripsApiKey } from "./trips/tripsApi.ts";
import TripsHome from "./trips/TripsHome.vue";

provide(tripsApiKey, createSupabaseTripsApi(supabase));

const { ready, session } = useSession(supabase);
const failure = ref<string | null>(null);

const displayName = computed(() => {
  const meta = session.value?.user.user_metadata ?? {};
  return (meta.full_name ?? meta.name ?? session.value?.user.email ?? "") as string;
});

async function leave() {
  failure.value = null;
  try {
    await signOut(supabase);
  } catch (error) {
    failure.value = `Couldn't sign out: ${errorMessage(error)}`;
  }
}
</script>

<template>
  <main>
    <p v-if="!ready" class="muted">Loading…</p>

    <SignIn v-else-if="!session" :sign-in="() => signInWithGoogle(supabase)" />

    <template v-else>
      <header class="app-header">
        <span class="app-name">今天吃什麼</span>
        <span class="who">{{ displayName }}</span>
        <button type="button" @click="leave">Sign out</button>
      </header>
      <p v-if="failure" role="alert" class="error">{{ failure }}</p>
      <!-- Keyed on the user so switching accounts starts from a clean slate. -->
      <TripsHome :key="session.user.id" />
    </template>
  </main>
</template>
