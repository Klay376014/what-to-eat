<script setup lang="ts">
/*
 * The trip calendar has stopped updating (#13), said at the top of the trip
 * rather than in the calendar card further down: a calendar that silently
 * stopped is worse than none, since people trust it and go to the wrong
 * restaurant. Any member can connect a calendar again from here: the holder
 * reconnects their own, anyone else takes it over.
 */
import { computed, ref } from "vue";
import { errorMessage } from "../lib/errors.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import { calendarBroken } from "./calendarStatus.ts";
import { useTripCalendar } from "./useTripCalendar.ts";

const calendar = useTripCalendar()!;
const broken = computed(() => calendarBroken(calendar.status.value?.connection ?? null));
const starting = ref(false);
const failure = ref<string | null>(null);

async function connect() {
  starting.value = true;
  failure.value = null;
  try {
    await calendar.startConnecting();
  } catch (error) {
    failure.value = errorMessage(error);
    starting.value = false;
  }
}
</script>

<template>
  <div v-if="broken" role="alert" class="calendar-alert">
    <p class="headline"><BaseIcon name="calendar-blank" /> {{ broken.headline }}</p>
    <p>{{ broken.detail }}</p>
    <p v-if="failure" class="error">{{ failure }}</p>
    <div>
      <BaseButton variant="primary" :disabled="starting || calendar.busy.value" @click="connect">
        {{ broken.action }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.calendar-alert {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--warning-bg);
  border: var(--card-border-width) solid var(--warning-border);
  border-radius: var(--radius-card);
}

.headline {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: var(--strong-weight);
}
</style>
