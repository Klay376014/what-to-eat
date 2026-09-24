<script setup lang="ts">
import { reactive, ref } from "vue";
import { errorMessage } from "../lib/errors.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import ConfirmDialog from "../ui/ConfirmDialog.vue";
import { contentOutsideRange, type DatedContent, type Trip, type TripSettings } from "./trip.ts";
import TripFields from "./TripFields.vue";
import { validateTripSettings, type TripSettingsErrors } from "./tripSettings.ts";
import { useTripsApi } from "./tripsApi.ts";

const props = defineProps<{ trip: Trip }>();
const emit = defineEmits<{ saved: [trip: Trip]; deleted: [id: string]; cancel: [] }>();

const api = useTripsApi();
const settings = reactive<TripSettings>({
  name: props.trip.name,
  startDate: props.trip.startDate,
  endDate: props.trip.endDate,
  timezone: props.trip.timezone,
});
const errors = ref<TripSettingsErrors>({});
const failure = ref<string | null>(null);
const busy = ref(false);
/** Set while asking whether to go ahead with a date change. */
const stranded = ref<DatedContent[] | null>(null);
const confirmingDelete = ref(false);

async function run(action: () => Promise<void>, failurePrefix: string) {
  busy.value = true;
  failure.value = null;
  try {
    await action();
  } catch (error) {
    failure.value = `${failurePrefix}: ${errorMessage(error)}`;
  } finally {
    busy.value = false;
  }
}

function datesChanged() {
  return settings.startDate !== props.trip.startDate || settings.endDate !== props.trip.endDate;
}

async function submit() {
  errors.value = validateTripSettings(settings);
  if (Object.keys(errors.value).length > 0) return;

  let affected: DatedContent[] = [];
  await run(async () => {
    if (datesChanged()) {
      affected = contentOutsideRange(await api.listDatedContent(props.trip.id), settings);
      // A warning, not a block: the organiser decides.
      if (affected.length > 0) return;
    }
    emit("saved", await api.updateTrip(props.trip.id, { ...settings }));
  }, "Couldn't save the trip");
  // Opened only once the check is over: while busy, the dialog's buttons are
  // disabled, and "Keep editing" could not take the focus it opens with.
  if (affected.length > 0) stranded.value = affected;
}

async function saveAnyway() {
  await run(async () => {
    emit("saved", await api.updateTrip(props.trip.id, { ...settings }));
    stranded.value = null;
  }, "Couldn't save the trip");
}

function openDelete() {
  failure.value = null;
  confirmingDelete.value = true;
}

async function deleteTrip() {
  await run(async () => {
    await api.deleteTrip(props.trip.id);
    emit("deleted", props.trip.id);
  }, "Couldn't delete the trip");
}
</script>

<template>
  <!-- A warning, not a block: the organiser decides (PRD stories 8 and 9). -->
  <ConfirmDialog
    :open="stranded !== null"
    title="Some meals would fall outside the new dates"
    confirm-label="Change dates and hide these meals"
    cancel-label="Keep editing"
    :busy="busy"
    @confirm="saveAnyway"
    @cancel="stranded = null"
  >
    <!-- Stranded meals are hidden from the grid, not shown there (ADR 0003):
         this warning is the one place that says so. -->
    <p>
      These meals fall outside the new dates. They won't appear in the trip grid until the dates
      include them again. Check them with the group, or re-add them on the new days.
    </p>
    <ul>
      <li v-for="item in stranded" :key="item.id">{{ item.label }}</li>
    </ul>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
  </ConfirmDialog>

  <ConfirmDialog
    :open="confirmingDelete"
    :title="`Delete “${trip.name}”?`"
    confirm-label="Delete for everyone"
    cancel-label="Keep the trip"
    destructive
    :busy="busy"
    @confirm="deleteTrip"
    @cancel="confirmingDelete = false"
  >
    <p>This removes the trip for every member, and cannot be undone.</p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
  </ConfirmDialog>

  <form class="stack" novalidate @submit.prevent="submit">
    <h3>Edit trip</h3>
    <TripFields :model-value="settings" :errors="errors" />
    <p v-if="failure && !stranded && !confirmingDelete" role="alert" class="error">
      {{ failure }}
    </p>
    <div class="actions">
      <BaseButton type="submit" variant="primary" :disabled="busy">Save</BaseButton>
      <BaseButton :disabled="busy" @click="emit('cancel')">Cancel</BaseButton>
    </div>
    <div class="danger-zone">
      <BaseButton variant="destructive" :disabled="busy" @click="openDelete">
        <BaseIcon name="trash" /> Delete trip
      </BaseButton>
    </div>
  </form>
</template>

<style scoped>
.danger-zone {
  border-top: var(--border-width) solid var(--border);
  padding-top: var(--space-4);
}
</style>
