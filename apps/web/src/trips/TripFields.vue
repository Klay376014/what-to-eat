<script setup lang="ts">
import TextField from "../ui/TextField.vue";
import SelectField from "../ui/SelectField.vue";
import type { TripSettings } from "./trip.ts";
import { MAX_TRIP_NAME_LENGTH, timeZoneOptions, type TripSettingsErrors } from "./tripSettings.ts";

// The fields shared by creating and editing a trip. The parent owns the
// settings object; these inputs edit it in place.
const settings = defineModel<TripSettings>({ required: true });
defineProps<{ errors: TripSettingsErrors }>();

const zones = timeZoneOptions();
// A browser can report an alias (Asia/Calcutta) the list spells differently;
// keep the current value selectable rather than silently changing it.
const options =
  zones.includes(settings.value.timezone) || !settings.value.timezone
    ? zones
    : [settings.value.timezone, ...zones];

function setDate(field: "startDate" | "endDate", value: string) {
  settings.value[field] = value === "" ? null : value;
}
</script>

<template>
  <TextField
    v-model="settings.name"
    label="Trip name"
    autocomplete="off"
    :maxlength="MAX_TRIP_NAME_LENGTH + 20"
    :error="errors.name"
  />

  <fieldset class="dates">
    <legend>Dates <span class="hint">(optional — leave empty for everyday use)</span></legend>
    <TextField
      :model-value="settings.startDate ?? ''"
      label="Start date"
      type="date"
      :error="errors.startDate"
      @update:model-value="setDate('startDate', $event)"
    />
    <TextField
      :model-value="settings.endDate ?? ''"
      label="End date"
      type="date"
      :min="settings.startDate ?? undefined"
      :error="errors.endDate"
      @update:model-value="setDate('endDate', $event)"
    />
  </fieldset>

  <SelectField
    v-model="settings.timezone"
    label="Timezone"
    hint="Every time in the trip is shown in this timezone."
    :error="errors.timezone"
  >
    <option value="" disabled>Choose where the trip takes place</option>
    <option v-for="zone in options" :key="zone" :value="zone">
      {{ zone.replaceAll("_", " ") }}
    </option>
  </SelectField>
</template>

<style scoped>
.dates {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  gap: var(--space-3);
}

.dates legend {
  font-weight: var(--label-weight);
  padding: 0;
  margin-bottom: var(--space-2);
}

.dates legend .hint {
  font-weight: var(--body-weight);
}
</style>
