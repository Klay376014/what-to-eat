<script setup lang="ts">
/*
 * One day's meals on a trail (ADR 0003): breakfast, lunch and dinner, then
 * the day's "other" meals in the order added, down a dashed route line with a
 * pin per meal, filled when the meal is decided (ADR 0002, sunlight rule 2).
 * The pin is decoration; each meal's MealSlotMarker carries its state.
 *
 * Each meal's button opens its details below it. A breakfast, lunch or
 * dinner nobody has added yet is offered for adding there; "Add another
 * meal" adds an "other" meal with its own name.
 */
import { nextTick, ref, useId, useTemplateRef, watch } from "vue";
import { errorMessage } from "../lib/errors.ts";
import type { IsoDate } from "../trips/trip.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import MealSlotMarker from "../ui/MealSlotMarker.vue";
import TextField from "../ui/TextField.vue";
import { MAX_MEAL_LABEL_LENGTH, validateMealLabel, type FixedSlot } from "./meal.ts";
import type { TrailEntry } from "./tripDays.ts";

export type AddMeal = (meal: { slot: FixedSlot } | { slot: "other"; label: string }) => Promise<{
  /** False when someone else had added that breakfast, lunch or dinner first. */
  added: boolean;
  /** Why their meal could not be fetched to show it, when it could not. */
  refreshFailure: string | null;
}>;

const props = defineProps<{ date: IsoDate; trail: readonly TrailEntry[]; add: AddMeal }>();

const id = useId();
const expanded = ref<string | null>(null);
const busy = ref(false);
const failure = ref<string | null>(null);
const notice = ref<string | null>(null);

const adding = ref(false);
const label = ref("");
const labelError = ref<string | undefined>(undefined);
const addFailure = ref<string | null>(null);
const addForm = useTemplateRef<HTMLFormElement>("addForm");
const addButton = useTemplateRef<InstanceType<typeof BaseButton>>("addButton");

// A different day starts with everything closed.
watch(
  () => props.date,
  () => {
    expanded.value = null;
    closeAdding();
  },
);

function toggle(entry: TrailEntry) {
  failure.value = null;
  notice.value = null;
  expanded.value = expanded.value === entry.key ? null : entry.key;
}

/** Runs an add, reporting a failure through `report`. */
async function run(action: () => Promise<void>, report: (message: string | null) => void) {
  busy.value = true;
  report(null);
  try {
    await action();
  } catch (error) {
    report(`Couldn't add the meal: ${errorMessage(error)}`);
  } finally {
    busy.value = false;
  }
}

async function startPlanning(entry: TrailEntry) {
  const slot = entry.slot as FixedSlot;
  notice.value = null;
  await run(
    async () => {
      const { added, refreshFailure } = await props.add({ slot });
      if (added) return;
      notice.value = `Someone else added ${entry.name.toLowerCase()} first.`;
      if (refreshFailure) {
        notice.value += ` Couldn't refresh the meals to show it: ${refreshFailure}`;
      }
    },
    (message) => (failure.value = message),
  );
}

async function openAdding() {
  adding.value = true;
  await nextTick();
  addForm.value?.querySelector("input")?.focus();
}

function closeAdding() {
  adding.value = false;
  label.value = "";
  labelError.value = undefined;
  addFailure.value = null;
}

async function submitOther() {
  labelError.value = validateMealLabel(label.value) ?? undefined;
  if (labelError.value) return;
  await run(
    async () => {
      await props.add({ slot: "other", label: label.value.trim() });
      closeAdding();
      await nextTick();
      (addButton.value?.$el as HTMLElement | undefined)?.focus();
    },
    (message) => (addFailure.value = message),
  );
}
</script>

<template>
  <ol class="trail">
    <li
      v-for="entry in trail"
      :key="entry.key"
      class="stop"
      :class="{ 'stop--decided': entry.state.state === 'decided' }"
    >
      <span class="pin" aria-hidden="true" />
      <button
        type="button"
        class="slot"
        :aria-expanded="expanded === entry.key ? 'true' : 'false'"
        :aria-controls="`${id}-${entry.key}`"
        @click="toggle(entry)"
      >
        <!-- The trailing space keeps the name apart from the state when read out. -->
        <span class="slot-name">{{ `${entry.name} ` }}</span>
        <MealSlotMarker :slot="entry.state" />
      </button>

      <div v-if="expanded === entry.key" :id="`${id}-${entry.key}`" class="details stack-sm">
        <template v-if="entry.meal === null">
          <p>Nobody has started planning {{ entry.name.toLowerCase() }} yet.</p>
          <div>
            <BaseButton variant="primary" :disabled="busy" @click="startPlanning(entry)">
              Start planning {{ entry.name.toLowerCase() }}
            </BaseButton>
          </div>
        </template>
        <!-- TODO(#8): the meal's proposals, and proposing a restaurant, go here. -->
        <p v-else-if="entry.state.state === 'empty'">
          {{ entry.name }} is open for proposals. Nobody has proposed a restaurant yet.
        </p>
        <p v-else-if="entry.state.state === 'discussing'">
          {{ entry.state.proposals }}
          {{ entry.state.proposals === 1 ? "restaurant is" : "restaurants are" }} being discussed
          for {{ entry.name.toLowerCase() }}.
        </p>
        <p v-else>{{ entry.name }} is decided: {{ entry.state.restaurant }}.</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="failure" role="alert" class="error">{{ failure }}</p>
      </div>
    </li>
  </ol>

  <form v-if="adding" ref="addForm" class="add stack-sm" novalidate @submit.prevent="submitOther">
    <TextField
      v-model="label"
      label="What's the meal?"
      hint="Afternoon tea, a late-night snack, an airport last meal…"
      autocomplete="off"
      :maxlength="MAX_MEAL_LABEL_LENGTH + 20"
      :error="labelError"
    />
    <p v-if="addFailure" role="alert" class="error">{{ addFailure }}</p>
    <div class="actions">
      <BaseButton type="submit" variant="primary" :disabled="busy">Add meal</BaseButton>
      <BaseButton :disabled="busy" @click="closeAdding">Cancel</BaseButton>
    </div>
  </form>
  <div v-else>
    <BaseButton ref="addButton" @click="openAdding">
      <BaseIcon name="plus" /> Add another meal
    </BaseButton>
  </div>
</template>

<style scoped>
/* The route: a dashed line down the left, a pin at each stop. */
.trail {
  list-style: none;
  margin: 0;
  padding: 0 0 0 calc(var(--route-dot-size) + var(--space-3));
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.trail::before {
  content: "";
  position: absolute;
  top: var(--space-4);
  bottom: var(--space-4);
  left: calc(var(--route-dot-size) / 2 - 1px);
  border-left: var(--control-border-width) dashed var(--route);
}

.stop {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

/* Hollow while the meal is open, filled once it is decided. Level with the
   meal's name. */
.pin {
  position: absolute;
  top: var(--space-1);
  left: calc(-1 * (var(--route-dot-size) + var(--space-3)));
  width: var(--route-dot-size);
  height: var(--route-dot-size);
  border-radius: var(--route-dot-radius);
  transform: rotate(var(--route-dot-rotate));
  border: var(--control-border-width) solid var(--route);
  background: var(--surface);
}

.stop--decided .pin {
  background: var(--route);
}

/* The whole stop is the button: its name, and the marker carrying the state. */
.slot {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-slot);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}

.slot-name {
  font-weight: var(--label-weight);
}

.details {
  padding: var(--space-3);
  background: var(--surface-2);
  border-radius: var(--radius-slot);
}

.add {
  border-top: var(--border-width) solid var(--border);
  padding-top: var(--space-4);
}
</style>
