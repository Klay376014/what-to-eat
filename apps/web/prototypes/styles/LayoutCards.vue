<script setup lang="ts">
/* Layout A: one card per day, stacked; each day's meals hang off a trail. */
import BaseButton from "../../src/ui/BaseButton.vue";
import BaseCard from "../../src/ui/BaseCard.vue";
import BaseIcon from "../../src/ui/BaseIcon.vue";
import MealSlotMarker from "../../src/ui/MealSlotMarker.vue";
import { days, openCount, slotLabel } from "./mockTrip.ts";
</script>

<template>
  <div class="stack">
    <BaseCard v-for="(day, i) in days" :key="day.date" :aria-labelledby="`a-day-${i}`">
      <h3 :id="`a-day-${i}`" class="day-title">
        <span>{{ day.weekday }} {{ day.label }}</span>
        <span class="muted small">Day {{ i + 1 }} · {{ openCount(day) }} open</span>
      </h3>
      <ol class="trail">
        <li
          v-for="meal in day.meals"
          :key="meal.label"
          class="stop"
          :class="{ 'is-decided': meal.slot.state === 'decided' }"
        >
          <span class="stop-label">
            <span v-if="meal.kind === 'other'" class="kicker">Other</span>
            {{ meal.label }}
          </span>
          <button type="button" class="slot-button" :aria-label="slotLabel(meal, day)">
            <MealSlotMarker :slot="meal.slot" />
          </button>
        </li>
      </ol>
      <BaseButton variant="quiet" block><BaseIcon name="plus" /> Add another meal</BaseButton>
    </BaseCard>
  </div>
</template>

<style scoped src="./trail.css"></style>
<style scoped>
.day-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-2);
}

.small {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: var(--body-weight);
}
</style>
