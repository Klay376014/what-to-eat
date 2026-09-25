<script setup lang="ts">
/*
 * The trip's calendar (#12): whether decided meals are reaching a Google
 * Calendar, and connecting one. Any member may connect; it takes their own
 * Google account and a permission separate from signing in (ADR 0001).
 *
 * Decided meals wait for a calendar rather than block on one, so this says
 * how many are not on it yet, and loudly when writing them failed. Coming
 * back from Google's consent screen lands here, where the connection is
 * finished and everything waiting is written in one pass.
 */
import { computed, onMounted, ref, useId } from "vue";
import type { Trip } from "../trips/trip.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import { clearCalendarReturn, pendingCalendarReturn } from "./calendarConnect.ts";
import { calendarWaiting, holderLabel } from "./calendarStatus.ts";
import { useTripCalendar } from "./useTripCalendar.ts";

const props = defineProps<{ trip: Pick<Trip, "id" | "name"> }>();

const headingId = useId();
const calendar = useTripCalendar()!;
const { status, busy, failure, loadFailure } = calendar;

const notice = ref<string | null>(null);
const returnFailure = ref<string | null>(null);
const starting = ref(false);

const connection = computed(() => status.value?.connection ?? null);
const waiting = computed(() => calendarWaiting(status.value?.meals ?? []));

function meals(n: number): string {
  return n === 1 ? "1 decided meal" : `${n} decided meals`;
}

onMounted(async () => {
  const returned = pendingCalendarReturn();
  // A forged or stale answer names no trip; whichever trip opens says so.
  if (returned && (returned.tripId === props.trip.id || returned.tripId === null)) {
    clearCalendarReturn();
    if ("code" in returned) {
      const result = await calendar.connect(returned);
      if (result) {
        notice.value =
          result.written === 0
            ? "Connected. Decided meals will go on the calendar as they are made."
            : `Connected. ${meals(result.written)} ${result.written === 1 ? "is" : "are"} now on the calendar.`;
      }
      return;
    }
    returnFailure.value = returned.error;
  }

  await calendar.refresh();
  // Meals left waiting, say by a tab closed before it wrote them.
  if (connection.value?.ready && waiting.value.pending + waiting.value.failed > 0) {
    await calendar.sync();
  }
});

async function connect() {
  starting.value = true;
  returnFailure.value = null;
  try {
    await calendar.startConnecting();
  } catch (error) {
    returnFailure.value = error instanceof Error ? error.message : String(error);
    starting.value = false;
  }
}
</script>

<template>
  <BaseCard as="section" :aria-labelledby="headingId" class="stack-sm">
    <h2 :id="headingId" class="heading"><BaseIcon name="calendar-blank" /> Calendar</h2>

    <p v-if="loadFailure" role="alert" class="error">{{ loadFailure }}</p>
    <p v-if="returnFailure" role="alert" class="error">{{ returnFailure }}</p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>

    <p v-if="status === null && !loadFailure" class="muted">Checking the trip calendar…</p>

    <template v-else-if="status && !connection">
      <p>
        Connect a Google Calendar and each decided meal goes on it, with everyone in the trip
        invited, so it shows up in their own calendars.
      </p>
      <p class="muted">
        The app makes a new calendar for this trip on your Google account. It can't see or change
        your other calendars.
      </p>
      <p v-if="waiting.pending + waiting.failed > 0" class="waiting">
        {{ meals(waiting.pending + waiting.failed) }}
        {{ waiting.pending + waiting.failed === 1 ? "isn't" : "aren't" }} on a calendar yet.
      </p>
      <div>
        <BaseButton variant="primary" :disabled="starting || busy" @click="connect">
          Connect Google Calendar
        </BaseButton>
      </div>
    </template>

    <template v-else-if="connection">
      <p>
        Decided meals go on the “{{ trip.name }}” calendar on {{ holderLabel(connection) }} Google
        account, and everyone in the trip is invited.
      </p>
      <p v-if="busy" class="muted">Writing to the calendar…</p>
      <template v-else>
        <p v-if="waiting.pending > 0" class="waiting">
          {{ meals(waiting.pending) }} {{ waiting.pending === 1 ? "isn't" : "aren't" }} on the
          calendar yet.
        </p>
        <p v-if="waiting.failed > 0" role="alert" class="error">
          {{ meals(waiting.failed) }} couldn't be written to the calendar. Open
          {{ waiting.failed === 1 ? "it" : "them" }} to see why.
        </p>
        <div v-if="waiting.pending + waiting.failed > 0">
          <BaseButton @click="calendar.sync()">Try again</BaseButton>
        </div>
      </template>
    </template>
  </BaseCard>
</template>

<style scoped>
.heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-lg);
}

.waiting {
  font-weight: var(--strong-weight);
}
</style>
