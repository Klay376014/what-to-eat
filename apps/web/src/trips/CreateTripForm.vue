<script setup lang="ts">
import { reactive, ref } from "vue";
import { errorMessage } from "../lib/errors.ts";
import type { Trip, TripSettings } from "./trip.ts";
import TripFields from "./TripFields.vue";
import { defaultTimeZone, validateTripSettings, type TripSettingsErrors } from "./tripSettings.ts";
import { useTripsApi } from "./tripsApi.ts";

defineProps<{ cancellable?: boolean }>();
const emit = defineEmits<{ created: [trip: Trip]; cancel: [] }>();

const api = useTripsApi();
const settings = reactive<TripSettings>({
  name: "",
  startDate: null,
  endDate: null,
  timezone: defaultTimeZone(),
});
const errors = ref<TripSettingsErrors>({});
const failure = ref<string | null>(null);
const saving = ref(false);

async function submit() {
  errors.value = validateTripSettings(settings);
  failure.value = null;
  if (Object.keys(errors.value).length > 0) return;

  saving.value = true;
  try {
    emit("created", await api.createTrip({ ...settings }));
  } catch (error) {
    failure.value = `Couldn't create the trip: ${errorMessage(error)}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="stack" novalidate @submit.prevent="submit">
    <h2>New trip</h2>
    <TripFields :model-value="settings" :errors="errors" />
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
    <div class="actions">
      <button type="submit" class="primary" :disabled="saving">
        {{ saving ? "Creating…" : "Create trip" }}
      </button>
      <button v-if="cancellable" type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>
