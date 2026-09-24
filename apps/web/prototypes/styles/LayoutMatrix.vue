<script setup lang="ts">
/*
 * Layout B: a real table, meals down the side and days across, scrolling
 * sideways inside its own container (never the page). The meal column sticks.
 */
import BaseIcon from "../../src/ui/BaseIcon.vue";
import MealSlotMarker from "../../src/ui/MealSlotMarker.vue";
import { days, openCount, slotLabel, type Meal } from "./mockTrip.ts";

const fixed = ["breakfast", "lunch", "dinner"] as const;
const names = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function meal(dayIndex: number, kind: (typeof fixed)[number]): Meal {
  return days[dayIndex]!.meals.find((m) => m.kind === kind)!;
}
function others(dayIndex: number): Meal[] {
  return days[dayIndex]!.meals.filter((m) => m.kind === "other");
}
</script>

<template>
  <div class="scroller" role="region" aria-label="Trip grid, scrolls sideways" tabindex="0">
    <table class="matrix">
      <caption class="visually-hidden">
        Meals by day
      </caption>
      <thead>
        <tr>
          <th scope="col" class="corner"><span class="visually-hidden">Meal</span></th>
          <th v-for="day in days" :key="day.date" scope="col" class="day-head">
            <span class="day-name">{{ day.weekday }} {{ day.label }}</span>
            <span class="open">{{ openCount(day) }} open</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="kind in fixed" :key="kind">
          <th scope="row" class="meal-head">{{ names[kind] }}</th>
          <td v-for="(day, i) in days" :key="day.date">
            <button type="button" class="cell" :aria-label="slotLabel(meal(i, kind), day)">
              <MealSlotMarker :slot="meal(i, kind).slot" />
            </button>
          </td>
        </tr>
        <tr>
          <th scope="row" class="meal-head">Other</th>
          <td v-for="(day, i) in days" :key="day.date" class="others">
            <button
              v-for="m in others(i)"
              :key="m.label"
              type="button"
              class="cell"
              :aria-label="slotLabel(m, day)"
            >
              <span class="other-label">{{ m.label }}</span>
              <MealSlotMarker :slot="m.slot" />
            </button>
            <button
              type="button"
              class="add"
              :aria-label="`Add another meal, ${day.weekday} ${day.label}`"
            >
              <BaseIcon name="plus" /> Add
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scroller {
  /* A flex child would otherwise grow to the table's width and widen the page. */
  position: relative;
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  background: var(--surface);
  border: var(--card-border-width) solid var(--border-strong);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

.matrix {
  border-collapse: separate;
  border-spacing: 0;
  min-width: 100%;
}

th,
td {
  padding: var(--space-1);
  vertical-align: top;
  text-align: left;
  border-bottom: var(--border-width) solid var(--border);
}

.corner,
.meal-head {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface);
  border-right: var(--border-width) solid var(--border);
}

.meal-head {
  width: 4.75rem;
  min-width: 4.75rem;
  font-size: var(--text-sm);
  font-weight: var(--label-weight);
  padding-top: var(--space-4);
}

.day-head {
  min-width: 8.5rem;
  width: 8.5rem;
  padding: var(--space-2) var(--space-1);
}

.day-name {
  display: block;
  font-family: var(--font-heading);
  font-weight: var(--heading-weight);
}

.open {
  display: block;
  font-size: var(--text-sm);
  font-weight: var(--body-weight);
  color: var(--muted);
}

.cell,
.add {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  border-radius: var(--radius-slot);
  cursor: pointer;
  touch-action: manipulation;
}

.cell :deep(.marker) {
  font-size: var(--text-sm);
}

.others {
  display: table-cell;
}

.others .cell + .cell,
.others .add {
  margin-top: var(--space-1);
}

.other-label {
  display: block;
  font-size: 0.75rem;
  color: var(--muted);
  padding: 2px 2px 0;
}

.add {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  color: var(--link);
  font-weight: var(--label-weight);
}
</style>
