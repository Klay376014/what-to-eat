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
 *
 * Each member also chooses here whether the trip's events invite them
 * (#14): a guest's email address is shown to every other guest. Turning it
 * off or on rewrites the events already on the calendar.
 *
 * Any member but its holder can take the calendar over (#13), onto a new
 * calendar of their own. While it works that takes a confirmation, since
 * everyone is invited again from the new one; once it has stopped
 * updating, the alert at the top of the trip (CalendarAlert.vue) offers it.
 * After a takeover this says whose old calendar to have deleted.
 */
import { computed, onMounted, ref, useId, watch } from "vue";
import type { Trip } from "../trips/trip.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import CheckboxField from "../ui/CheckboxField.vue";
import ConfirmDialog from "../ui/ConfirmDialog.vue";
import { clearCalendarReturn, pendingCalendarReturn } from "./calendarConnect.ts";
import {
  CALENDAR_GUEST_LABEL,
  calendarWaiting,
  handoverNote,
  holderLabel,
} from "./calendarStatus.ts";
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
const note = computed(() => handoverNote(connection.value, props.trip.name));
const confirmingTakeOver = ref(false);
const forgetting = ref(false);

async function forgetPrevious() {
  forgetting.value = true;
  try {
    await calendar.forgetPreviousCalendar();
  } finally {
    forgetting.value = false;
  }
}

// Shown as changed at once, and put back if the change could not be saved.
const attending = ref(true);
const savingSetting = ref(false);
watch(
  () => status.value?.attending,
  (value) => {
    // Not while a change is saving: a refresh finishing meanwhile would flick it back.
    if (value !== undefined && !savingSetting.value) attending.value = value;
  },
  { immediate: true },
);

async function changeAttending(value: boolean) {
  attending.value = value;
  savingSetting.value = true;
  try {
    if (!(await calendar.setAttending(value))) attending.value = !value;
  } finally {
    savingSetting.value = false;
  }
}

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
  // Writes meals left waiting, say by a tab closed before it wrote them. Run
  // with nothing waiting too: asking Google for a token is how a connection
  // that died since the last change is found (#13), before anyone trusts it.
  if (connection.value?.ready && !connection.value.lapse) await calendar.sync();
});

async function connect() {
  confirmingTakeOver.value = false;
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
        account, and everyone in the trip is invited as a guest, unless they choose not to be.
      </p>
      <p v-if="note" class="handover">
        {{ note.text }}
        <BaseButton
          v-if="note.canDismiss"
          variant="quiet"
          :disabled="forgetting"
          @click="forgetPrevious"
        >
          It's deleted
        </BaseButton>
      </p>
      <!-- Said loudly at the top of the trip (CalendarAlert.vue); here, only what it means. -->
      <p v-if="connection.lapse" class="waiting">
        Decided meals aren't reaching this calendar any more: it has stopped updating.
      </p>
      <p v-else-if="busy" class="muted">Writing to the calendar…</p>
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
      <div v-if="connection.ready && !connection.lapse && !connection.holderIsMe">
        <BaseButton variant="quiet" :disabled="starting || busy" @click="confirmingTakeOver = true">
          Take over the calendar
        </BaseButton>
      </div>
    </template>

    <ConfirmDialog
      :open="confirmingTakeOver && connection !== null"
      title="Take over the trip calendar?"
      confirm-label="Continue to Google"
      :busy="starting"
      @confirm="connect"
      @cancel="confirmingTakeOver = false"
    >
      <p>
        The app makes a new “{{ trip.name }}” calendar on your Google account and invites everyone
        to the decided meals again from it.
      </p>
      <p v-if="connection">
        {{ connection.holderName ?? "The current holder" }}'s calendar stops being updated: ask them
        to delete it, or everyone sees each meal twice.
      </p>
    </ConfirmDialog>

    <CheckboxField
      v-if="status"
      :model-value="attending"
      :disabled="savingSetting"
      :label="CALENDAR_GUEST_LABEL"
      hint="Guests can see each other's email addresses. Without it, you still see every decided meal here and still get the trip's emails."
      @update:model-value="changeAttending"
    />
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

.handover {
  padding: var(--space-3);
  background: var(--warning-bg);
  border: var(--border-width) solid var(--warning-border);
  border-radius: var(--radius-card);
}
</style>
