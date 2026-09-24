<script setup lang="ts">
/*
 * The empty / being discussed / decided marker for a meal slot, reused by the
 * trip grid (#7). The state is carried three ways, never by colour alone:
 * fill and border (dashed, tinted, solid), an icon, and text. Where the
 * visible text alone would not say the state, a visually hidden prefix does.
 * The marker is not interactive; the grid wraps it in its own button or link.
 */
import BaseIcon from "./BaseIcon.vue";
import type { MealSlotState } from "./mealSlotState.ts";

defineProps<{ slot: MealSlotState }>();
</script>

<template>
  <span class="marker" :class="`marker--${slot.state}`">
    <template v-if="slot.state === 'empty'">
      <BaseIcon name="plus" />
      <span class="text">Not planned</span>
    </template>
    <template v-else-if="slot.state === 'discussing'">
      <BaseIcon name="chats" />
      <span class="text">
        <span class="visually-hidden">Being discussed:</span>
        {{ slot.proposals }} {{ slot.proposals === 1 ? "proposal" : "proposals" }}
      </span>
    </template>
    <template v-else>
      <BaseIcon name="check-circle" />
      <span class="text name">
        <span class="visually-hidden">Decided:</span>
        {{ slot.restaurant }}
      </span>
    </template>
  </span>
</template>

<style scoped>
.marker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-slot);
  border: var(--control-border-width) solid transparent;
  text-align: left;
}

.text {
  flex: 1 1 auto;
  min-width: 0;
}

.marker--empty {
  background: var(--empty-bg);
  color: var(--empty-fg);
  border-style: dashed;
  border-color: var(--empty-border);
}

.marker--discussing {
  background: var(--discuss-bg);
  color: var(--discuss-fg);
  border-color: var(--discuss-border);
  font-weight: var(--label-weight);
}

.marker--decided {
  background: var(--decided-bg);
  color: var(--decided-fg);
  border-color: var(--decided-border);
  font-weight: var(--strong-weight);
}
</style>
