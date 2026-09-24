<script setup lang="ts">
import { reactive, ref } from "vue";
import { errorMessage } from "../lib/errors.ts";
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

  await run(async () => {
    if (datesChanged()) {
      const affected = contentOutsideRange(await api.listDatedContent(props.trip.id), settings);
      // A warning, not a block: the organiser decides.
      if (affected.length > 0) {
        stranded.value = affected;
        return;
      }
    }
    emit("saved", await api.updateTrip(props.trip.id, { ...settings }));
  }, "Couldn't save the trip");
}

async function saveAnyway() {
  await run(async () => {
    emit("saved", await api.updateTrip(props.trip.id, { ...settings }));
    stranded.value = null;
  }, "Couldn't save the trip");
}

async function deleteTrip() {
  await run(async () => {
    await api.deleteTrip(props.trip.id);
    emit("deleted", props.trip.id);
  }, "Couldn't delete the trip");
}
</script>

<template>
  <section
    v-if="stranded"
    role="alertdialog"
    aria-labelledby="stranded-title"
    class="card warning stack"
  >
    <h3 id="stranded-title">Some meals would fall outside the new dates</h3>
    <p>
      These stay in the trip, but they will no longer be on any of its days. Check them before you
      go ahead.
    </p>
    <ul>
      <li v-for="item in stranded" :key="item.id">{{ item.label }}</li>
    </ul>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
    <div class="actions">
      <button type="button" class="primary" :disabled="busy" @click="saveAnyway">
        Change dates anyway
      </button>
      <button type="button" :disabled="busy" @click="stranded = null">Keep editing</button>
    </div>
  </section>

  <section
    v-else-if="confirmingDelete"
    role="alertdialog"
    aria-labelledby="delete-title"
    class="card warning stack"
  >
    <h3 id="delete-title">Delete “{{ trip.name }}”?</h3>
    <p>This removes the trip for every member, and cannot be undone.</p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
    <div class="actions">
      <button type="button" class="destructive" :disabled="busy" @click="deleteTrip">
        Delete for everyone
      </button>
      <button type="button" :disabled="busy" @click="confirmingDelete = false">
        Keep the trip
      </button>
    </div>
  </section>

  <form v-else class="stack" novalidate @submit.prevent="submit">
    <h3>Edit trip</h3>
    <TripFields :model-value="settings" :errors="errors" />
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
    <div class="actions">
      <button type="submit" class="primary" :disabled="busy">Save</button>
      <button type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </div>
    <div class="danger-zone">
      <button type="button" class="destructive" :disabled="busy" @click="confirmingDelete = true">
        Delete trip
      </button>
    </div>
  </form>
</template>
