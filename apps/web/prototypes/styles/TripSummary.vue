<script setup lang="ts">
/* The header every layout shares: which trip, and how much is left to plan. */
import BaseCard from "../../src/ui/BaseCard.vue";
import BaseIcon from "../../src/ui/BaseIcon.vue";
import MealSlotMarker from "../../src/ui/MealSlotMarker.vue";
import { totals, trip } from "./mockTrip.ts";
</script>

<template>
  <BaseCard>
    <h2>{{ trip.name }}</h2>
    <p class="muted meta">
      <BaseIcon name="calendar" :size="18" /> {{ trip.dates }} · {{ trip.timezone }}
    </p>
    <p>
      <strong>{{ totals.decided }} of {{ totals.meals }}</strong> meals decided,
      <strong>{{ totals.empty }}</strong> not planned yet
    </p>
    <ul class="legend" aria-label="Map legend">
      <li><MealSlotMarker :slot="{ state: 'empty' }" /></li>
      <li><MealSlotMarker :slot="{ state: 'discussing', proposals: 2 }" /></li>
      <li><MealSlotMarker :slot="{ state: 'decided', restaurant: 'Decided meal' }" /></li>
    </ul>
  </BaseCard>
</template>

<style scoped>
.meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.legend {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
  gap: var(--space-2);
  font-size: var(--text-sm);
}
</style>
