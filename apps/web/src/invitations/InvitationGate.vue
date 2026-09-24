<script setup lang="ts">
/*
 * Uses a pending invitation, then shows the signed-in app.
 *
 * With a token, it joins first and only then renders the default slot, so
 * the trips list it wraps loads with the new trip in it and opens on it
 * (`openTripId`). A link that does not work is explained above the trips
 * rather than dropped. Without a token it renders the slot straight away.
 */
import { computed, onMounted, ref } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";
import { explainJoinFailure, type JoinFailureReason } from "./invitation.ts";
import { JoinError, useMembershipApi } from "./membershipApi.ts";

const props = defineProps<{ token: string | null }>();
const emit = defineEmits<{ settled: [] }>();
defineSlots<{ default(props: { openTripId: string | null }): unknown }>();

const api = useMembershipApi();

type State =
  | { kind: "idle" }
  | { kind: "joining" }
  | { kind: "joined"; tripId: string }
  | { kind: "failed"; reason: JoinFailureReason };

const state = ref<State>(props.token ? { kind: "joining" } : { kind: "idle" });
const showNotice = ref(true);

const openTripId = computed(() => (state.value.kind === "joined" ? state.value.tripId : null));
const failure = computed(() =>
  state.value.kind === "failed" ? explainJoinFailure(state.value.reason) : null,
);

onMounted(async () => {
  if (!props.token) return;
  try {
    state.value = { kind: "joined", tripId: await api.joinTrip(props.token) };
  } catch (error) {
    state.value = {
      kind: "failed",
      reason: error instanceof JoinError ? error.reason : "unknown",
    };
  } finally {
    // Used or refused, the invitation is spent: a reload must not retry it.
    emit("settled");
  }
});
</script>

<template>
  <BaseCard v-if="state.kind === 'joining'">
    <p class="muted" role="status">Joining the trip…</p>
  </BaseCard>

  <template v-else>
    <section v-if="failure && showNotice" class="notice" role="alert">
      <h2 class="notice-title">{{ failure.title }}</h2>
      <p>{{ failure.body }}</p>
      <div><BaseButton @click="showNotice = false">Dismiss</BaseButton></div>
    </section>
    <BaseCard v-if="state.kind === 'joined'">
      <p role="status">You've joined the trip. Welcome aboard.</p>
    </BaseCard>

    <slot :open-trip-id="openTripId" />
  </template>
</template>

<style scoped>
/* A solid tinted surface, so the text never sits on the page texture. */
.notice {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--warning-bg);
  color: var(--text);
  border: var(--card-border-width) solid var(--warning-border);
  border-radius: var(--radius-card);
}

.notice-title {
  font-size: var(--text-lg);
}
</style>
