<script setup lang="ts">
/*
 * The trip grid: day tabs with a trail (docs/adr/0003-trip-grid-layout.md).
 * The strip of day tabs sums up every day in words; below it, the selected
 * day's meals sit on a trail. The selected day lives in the address as
 * `?day=`, so a link can open a given day.
 */
import { computed, onMounted, ref, useId } from "vue";
import { errorMessage } from "../lib/errors.ts";
import { dateIn, type IsoDate, type Trip } from "../trips/trip.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";
import TextField from "../ui/TextField.vue";
import { isIsoDate, readDayParam, writeDayParam } from "./dayParam.ts";
import DayTabs from "./DayTabs.vue";
import DayTrail, { type AddMeal, type RenameMeal } from "./DayTrail.vue";
import type { Meal } from "./meal.ts";
import { SlotTakenError, useMealsApi } from "./mealsApi.ts";
import { dayTabs, dayTrail, defaultDay, tripDates } from "./tripDays.ts";

const props = defineProps<{ trip: Trip }>();

const api = useMealsApi();
const id = useId();
const tabIdPrefix = `${id}-day`;
const panelId = `${id}-panel`;

const meals = ref<Meal[]>([]);
const loading = ref(true);
const failure = ref<string | null>(null);

/**
 * Today on the trip's own calendar, never the browser's. Follows the trip's
 * timezone, which the organiser can change without this grid remounting.
 */
const today = computed(() => dateIn(props.trip.timezone, new Date()));
// The grid is keyed on the trip, so the trip id is fixed for its lifetime.
const requested = readDayParam(props.trip.id);
const selected = ref<IsoDate | null>(null);
/** Days of an undated trip someone went to, before any meal is on them. */
const visited = ref<IsoDate[]>(requested ? [requested] : []);

const undated = computed(() => props.trip.startDate === null || props.trip.endDate === null);
const tabs = computed(() =>
  dayTabs(tripDates(props.trip, meals.value, today.value, visited.value), meals.value, today.value),
);
/**
 * The day shown. Chosen once when the meals arrive; if the trip's dates later
 * change under it, fall back to the default rather than show a day the trip
 * no longer has.
 */
const activeDay = computed(() => {
  const day = selected.value;
  if (day !== null && tabs.value.some((t) => t.date === day)) return day;
  return defaultDay(props.trip, tabs.value, today.value, requested);
});
const trail = computed(() => dayTrail(activeDay.value, meals.value));

async function load() {
  loading.value = true;
  failure.value = null;
  try {
    meals.value = await api.listMeals(props.trip.id);
    selected.value ??= defaultDay(props.trip, tabs.value, today.value, requested);
  } catch (error) {
    failure.value = `Couldn't load the meals: ${errorMessage(error)}`;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function select(day: IsoDate) {
  selected.value = day;
  writeDayParam(props.trip.id, day);
}

function goTo(day: string) {
  if (!isIsoDate(day)) return;
  if (!visited.value.includes(day)) visited.value = [...visited.value, day];
  select(day);
}

/** Renames an "other" meal and updates it in place on the trail. */
const rename: RenameMeal = async (mealId, label) => {
  const renamed = await api.renameMeal(mealId, label);
  meals.value = meals.value.map((m) => (m.id === mealId ? { ...m, label: renamed.label } : m));
};

const add: AddMeal = async (meal) => {
  const input =
    meal.slot === "other"
      ? { tripId: props.trip.id, date: activeDay.value, slot: meal.slot, label: meal.label }
      : { tripId: props.trip.id, date: activeDay.value, slot: meal.slot };
  try {
    const created = await api.addMeal(input);
    meals.value = [...meals.value, created];
    return { added: true, refreshFailure: null };
  } catch (error) {
    // Someone else added this breakfast, lunch or dinner first: show theirs.
    // Their meal exists whether or not the refresh works, so a failed
    // refresh is reported as that, never as this add failing.
    if (!(error instanceof SlotTakenError)) throw error;
    try {
      meals.value = await api.listMeals(props.trip.id);
      return { added: false, refreshFailure: null };
    } catch (refreshError) {
      return { added: false, refreshFailure: errorMessage(refreshError) };
    }
  }
};
</script>

<template>
  <section class="grid stack" aria-label="Meals">
    <BaseCard v-if="loading"><p class="muted">Loading the meals…</p></BaseCard>

    <BaseCard v-else-if="failure">
      <p role="alert" class="error">{{ failure }}</p>
      <div><BaseButton @click="load">Try again</BaseButton></div>
    </BaseCard>

    <template v-else>
      <DayTabs
        :tabs="tabs"
        :active="activeDay"
        :id-prefix="tabIdPrefix"
        :panel-id="panelId"
        @select="select"
      />

      <!-- An everyday trip has no fixed days: any day can be planned. -->
      <BaseCard v-if="undated" class="go-to">
        <TextField
          :model-value="activeDay"
          label="Go to a day"
          type="date"
          @update:model-value="goTo"
        />
      </BaseCard>

      <BaseCard :id="panelId" role="tabpanel" :aria-labelledby="`${tabIdPrefix}-${activeDay}`">
        <DayTrail :date="activeDay" :trail="trail" :add="add" :rename="rename" />
      </BaseCard>
    </template>
  </section>
</template>

<style scoped>
.go-to {
  padding: var(--space-3) var(--space-4);
}
</style>
