<script setup lang="ts">
/*
 * Uses a pending invitation, then shows the signed-in app.
 *
 * With a token, it first asks: joining makes the person a guest on the
 * trip's calendar events, which shows their email address to everyone else
 * in the trip, so they are told so before they commit, and may join without
 * being a guest (#14). Only once they press Join does it join, and then
 * render the default slot, so the trips list it wraps loads with the new
 * trip in it and opens on it (`openTripId`). A link that does not work is
 * explained above the trips rather than dropped. "Not now" spends the link
 * without joining. Without a token it renders the slot straight away.
 */
import { computed, ref, useId } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";
import { CALENDAR_GUEST_LABEL } from "../calendar/calendarStatus.ts";
import CheckboxField from "../ui/CheckboxField.vue";
import { explainJoinFailure, type JoinFailureReason } from "./invitation.ts";
import { JoinError, useMembershipApi } from "./membershipApi.ts";

const props = defineProps<{
  token: string | null;
  /** The signed-in account's email: the address the others would see. */
  email?: string | null;
}>();
const emit = defineEmits<{ settled: [] }>();
defineSlots<{ default(props: { openTripId: string | null }): unknown }>();

const api = useMembershipApi();
const headingId = useId();

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "joining" }
  | { kind: "joined"; tripId: string; isNew: boolean }
  | { kind: "failed"; reason: JoinFailureReason };

const state = ref<State>(props.token ? { kind: "asking" } : { kind: "idle" });
const showNotice = ref(true);
/** Whether to join as a guest on the trip's calendar events. */
const calendarAttendee = ref(true);

const openTripId = computed(() => (state.value.kind === "joined" ? state.value.tripId : null));
const failure = computed(() =>
  state.value.kind === "failed" ? explainJoinFailure(state.value.reason) : null,
);

async function join() {
  if (!props.token) return;
  state.value = { kind: "joining" };
  try {
    const { tripId, joined } = await api.joinTrip(props.token, {
      calendarAttendee: calendarAttendee.value,
    });
    state.value = { kind: "joined", tripId, isNew: joined };
  } catch (error) {
    state.value = {
      kind: "failed",
      reason: error instanceof JoinError ? error.reason : "unknown",
    };
  } finally {
    // Used or refused, the invitation is spent: a reload must not retry it.
    emit("settled");
  }
}

function decline() {
  state.value = { kind: "idle" };
  emit("settled");
}
</script>

<template>
  <BaseCard v-if="state.kind === 'asking'" as="section" :aria-labelledby="headingId">
    <h2 :id="headingId">You've been invited to a trip</h2>
    <p class="plain">
      Your email address<template v-if="email"> ({{ email }})</template> will be visible to the
      other people in this trip through calendar invitations.
    </p>
    <p class="muted">
      Decided meals go on a shared Google Calendar with everyone in the trip added as guests, and
      guests can see each other's addresses.
    </p>
    <CheckboxField
      v-model="calendarAttendee"
      :label="CALENDAR_GUEST_LABEL"
      hint="Untick this to keep your email to yourself. You'll still see every decided meal here, and still get the trip's emails. You can change it later in the trip."
    />
    <div class="actions">
      <BaseButton variant="primary" @click="join">Join trip</BaseButton>
      <BaseButton variant="quiet" @click="decline">Not now</BaseButton>
    </div>
  </BaseCard>

  <BaseCard v-else-if="state.kind === 'joining'">
    <p class="muted" role="status">Joining the trip…</p>
  </BaseCard>

  <template v-else>
    <section v-if="failure && showNotice" class="notice" role="alert">
      <h2 class="notice-title">{{ failure.title }}</h2>
      <p>{{ failure.body }}</p>
      <div><BaseButton @click="showNotice = false">Dismiss</BaseButton></div>
    </section>
    <!-- Only for someone new: a member reopening an old link just lands in the trip. -->
    <BaseCard v-if="state.kind === 'joined' && state.isNew">
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

.plain {
  font-weight: var(--strong-weight);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.notice-title {
  font-size: var(--text-lg);
}
</style>
