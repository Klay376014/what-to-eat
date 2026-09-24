<script setup lang="ts">
import { computed, provide, ref } from "vue";
import { signInWithGoogle, signOut, useSession } from "./auth/auth.ts";
import SignIn from "./auth/SignIn.vue";
import { errorMessage } from "./lib/errors.ts";
import { supabase } from "./lib/supabase.ts";
import { createSupabaseTripsApi, tripsApiKey } from "./trips/tripsApi.ts";
import TripsHome from "./trips/TripsHome.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCard from "./ui/BaseCard.vue";
import BaseIcon from "./ui/BaseIcon.vue";

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
  <header v-if="ready && session" class="app-header">
    <div class="app-header-inner">
      <span class="app-name">今天吃什麼</span>
      <span class="who">{{ displayName }}</span>
      <BaseButton variant="quiet" @click="leave"><BaseIcon name="sign-out" /> Sign out</BaseButton>
    </div>
  </header>

  <main class="page stack">
    <BaseCard v-if="!ready"><p class="muted">Loading…</p></BaseCard>

    <SignIn v-else-if="!session" :sign-in="() => signInWithGoogle(supabase)" />

    <template v-else>
      <BaseCard v-if="failure"
        ><p role="alert" class="error">{{ failure }}</p></BaseCard
      >
      <!-- Keyed on the user so switching accounts starts from a clean slate. -->
      <TripsHome :key="session.user.id" />
    </template>
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
  padding: var(--space-1) var(--space-4);
}

.app-name {
  font-family: var(--font-heading);
  font-weight: var(--heading-weight);
  font-size: var(--text-lg);
  margin-right: auto;
}

.who {
  color: var(--muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page {
  padding: var(--space-4) var(--space-4) calc(var(--space-6) * 2);
}
</style>
