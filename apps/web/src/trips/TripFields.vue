<script setup lang="ts">
import { useId } from "vue";
import type { TripSettings } from "./trip.ts";
import { MAX_TRIP_NAME_LENGTH, timeZoneOptions, type TripSettingsErrors } from "./tripSettings.ts";

// The fields shared by creating and editing a trip. The parent owns the
// settings object; these inputs edit it in place.
const settings = defineModel<TripSettings>({ required: true });
defineProps<{ errors: TripSettingsErrors }>();

const id = useId();
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
  <div class="field">
    <label :for="`${id}-name`">Trip name</label>
    <input
      :id="`${id}-name`"
      v-model="settings.name"
      type="text"
      autocomplete="off"
      :maxlength="MAX_TRIP_NAME_LENGTH + 20"
      :aria-invalid="errors.name ? 'true' : undefined"
      :aria-describedby="errors.name ? `${id}-name-error` : undefined"
    />
    <p v-if="errors.name" :id="`${id}-name-error`" class="field-error">{{ errors.name }}</p>
  </div>

  <fieldset class="dates">
    <legend>Dates <span class="hint">(optional — leave empty for everyday use)</span></legend>
    <div class="field">
      <label :for="`${id}-start`">Start date</label>
      <input
        :id="`${id}-start`"
        type="date"
        :value="settings.startDate ?? ''"
        :aria-invalid="errors.startDate ? 'true' : undefined"
        @input="setDate('startDate', ($event.target as HTMLInputElement).value)"
      />
      <p v-if="errors.startDate" class="field-error">{{ errors.startDate }}</p>
    </div>
    <div class="field">
      <label :for="`${id}-end`">End date</label>
      <input
        :id="`${id}-end`"
        type="date"
        :value="settings.endDate ?? ''"
        :min="settings.startDate ?? undefined"
        :aria-invalid="errors.endDate ? 'true' : undefined"
        @input="setDate('endDate', ($event.target as HTMLInputElement).value)"
      />
      <p v-if="errors.endDate" class="field-error">{{ errors.endDate }}</p>
    </div>
  </fieldset>

  <div class="field">
    <label :for="`${id}-timezone`">Timezone</label>
    <select
      :id="`${id}-timezone`"
      v-model="settings.timezone"
      :aria-invalid="errors.timezone ? 'true' : undefined"
    >
      <option value="" disabled>Choose where the trip takes place</option>
      <option v-for="zone in options" :key="zone" :value="zone">
        {{ zone.replaceAll("_", " ") }}
      </option>
    </select>
    <p class="hint">Every time in the trip is shown in this timezone.</p>
    <p v-if="errors.timezone" class="field-error">{{ errors.timezone }}</p>
  </div>
</template>
