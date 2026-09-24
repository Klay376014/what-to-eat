<script setup lang="ts">
/*
 * Layout C: a strip of day tabs, each showing how much of that day is still
 * open, and one day's trail at a time below it.
 */
import { computed, ref } from "vue";
import BaseButton from "../../src/ui/BaseButton.vue";
import BaseCard from "../../src/ui/BaseCard.vue";
import BaseIcon from "../../src/ui/BaseIcon.vue";
import MealSlotMarker from "../../src/ui/MealSlotMarker.vue";
import { days, emptyCount, openCount, slotLabel } from "./mockTrip.ts";

const selected = ref(0);
const day = computed(() => days[selected.value]!);
const tabs = ref<HTMLButtonElement[]>([]);

function move(delta: number) {
  selected.value = (selected.value + delta + days.length) % days.length;
  tabs.value[selected.value]?.focus();
}
</script>

<template>
  <BaseCard>
    <div
      class="strip"
      role="tablist"
      aria-label="Days"
      @keydown.right.prevent="move(1)"
      @keydown.left.prevent="move(-1)"
    >
      <button
        v-for="(d, i) in days"
        :id="`c-tab-${i}`"
        :key="d.date"
        ref="tabs"
        type="button"
        role="tab"
        class="tab"
        :aria-selected="i === selected"
        :aria-controls="`c-panel`"
        :tabindex="i === selected ? 0 : -1"
        @click="selected = i"
      >
        <span class="tab-day">{{ d.weekday }}</span>
        <span class="tab-date">{{ d.label.split(" ")[0] }}</span>
        <span class="tab-gaps">
          <template v-if="emptyCount(d) > 0"
            >{{ emptyCount(d) }} gap{{ emptyCount(d) === 1 ? "" : "s" }}</template
          >
          <template v-else-if="openCount(d) > 0">{{ openCount(d) }} open</template>
          <template v-else>Done</template>
        </span>
      </button>
    </div>

    <section id="c-panel" role="tabpanel" :aria-labelledby="`c-tab-${selected}`" class="stack">
      <h3 class="day-title">
        {{ day.weekday }} {{ day.label }}
        <span class="muted small">Day {{ selected + 1 }} of {{ days.length }}</span>
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
    </section>
  </BaseCard>
</template>

<style scoped src="./trail.css"></style>
<style scoped>
.strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-1);
}

.tab {
  min-height: 64px;
  padding: var(--space-1) 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  background: var(--surface);
  color: var(--text);
  border: var(--control-border-width) solid var(--border-strong);
  border-radius: var(--radius-control);
  cursor: pointer;
  touch-action: manipulation;
  line-height: 1.2;
}

.tab[aria-selected="true"] {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.tab-day {
  font-size: var(--text-sm);
  font-weight: var(--label-weight);
}

.tab-date {
  font-family: var(--font-heading);
  font-weight: var(--heading-weight);
  font-size: var(--text-lg);
}

.tab-gaps {
  font-size: 0.75rem;
  font-weight: var(--label-weight);
}

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
