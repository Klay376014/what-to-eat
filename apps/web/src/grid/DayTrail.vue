<script setup lang="ts">
/*
 * One day's meals on a trail (ADR 0003): breakfast, lunch and dinner, then
 * the day's "other" meals in the order added, down a dashed route line with a
 * pin per meal, filled when the meal is decided (ADR 0002, sunlight rule 2).
 * The pin is decoration; each meal's MealSlotMarker carries its state.
 *
 * Each meal's button opens its details below it. A breakfast, lunch or
 * dinner nobody has added yet is offered for adding there; a meal that
 * exists lists its proposals there, takes new ones (#8) and is decided
 * there (#11), and an "other"
 * meal can be renamed there. "Add another meal" adds an "other" meal with
 * its own name.
 *
 * Each meal starts at its slot's usual time, on the trip's clock, unless
 * someone sets its own (#12); that is the time its calendar event is for.
 */
import { nextTick, onMounted, ref, useId, useTemplateRef, watch } from "vue";
import { zoneCity } from "../calendar/calendarEvent.ts";
import { DEFAULT_START, mealStart } from "../calendar/mealTime.ts";
import { errorMessage } from "../lib/errors.ts";
import type { IsoDate } from "../trips/trip.ts";
import MealProposals from "../proposals/MealProposals.vue";
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

/** Renames an "other" meal; throws when the rename is refused. */
export type RenameMeal = (mealId: string, label: string) => Promise<void>;

/** Sets a meal's own start time ("HH:MM"), or null for its slot's usual one. */
export type SetMealTime = (mealId: string, startTime: string | null) => Promise<void>;

const props = defineProps<{
  date: IsoDate;
  trail: readonly TrailEntry[];
  add: AddMeal;
  rename: RenameMeal;
  setTime: SetMealTime;
  /** The trip's timezone: every time here is on its clock. */
  timeZone: string;
  /** Whether the signed-in member organises the trip. */
  organiser: boolean;
  /** A meal to open as the trail first shows, from an email's link (#15). */
  openMealId?: string | null;
}>();
const emit = defineEmits<{
  /** A meal's proposal count, as its details last loaded or changed it. */
  proposalCount: [mealId: string, count: number];
  /** A meal's decided restaurant, or null, as its details last loaded or changed it. */
  decided: [mealId: string, restaurant: string | null];
}>();

const id = useId();
const expanded = ref<string | null>(
  props.trail.find((entry) => entry.meal !== null && entry.meal.id === props.openMealId)?.key ??
    null,
);
// The meal an email's link opened is brought into view.
onMounted(() => {
  if (expanded.value === null) return;
  document.getElementById(`${id}-${expanded.value}`)?.scrollIntoView?.({ block: "start" });
});
const busy = ref(false);
const failure = ref<string | null>(null);
const notice = ref<string | null>(null);

const adding = ref(false);
const label = ref("");
const labelError = ref<string | undefined>(undefined);
const addFailure = ref<string | null>(null);
const addForm = useTemplateRef<HTMLFormElement>("addForm");
const addButton = useTemplateRef<InstanceType<typeof BaseButton>>("addButton");

/** The "other" meal whose name is being edited, if any. */
const renaming = ref<string | null>(null);
const newName = ref("");
const newNameError = ref<string | undefined>(undefined);
const renameFailure = ref<string | null>(null);
const renameForm = useTemplateRef<HTMLFormElement[]>("renameForm");
const renameButton = useTemplateRef<InstanceType<typeof BaseButton>[]>("renameButton");

/** The meal whose start time is being changed, if any. */
const retiming = ref<string | null>(null);
const newTime = ref("");
const newTimeError = ref<string | undefined>(undefined);
const timeFailure = ref<string | null>(null);
const timeForm = useTemplateRef<HTMLFormElement[]>("timeForm");
const retimeButton = useTemplateRef<InstanceType<typeof BaseButton>[]>("retimeButton");

// A different day starts with everything closed.
watch(
  () => props.date,
  () => {
    expanded.value = null;
    closeAdding();
    closeRenaming();
    closeRetiming();
  },
);

function toggle(entry: TrailEntry) {
  failure.value = null;
  notice.value = null;
  closeRenaming();
  closeRetiming();
  expanded.value = expanded.value === entry.key ? null : entry.key;
}

async function openRenaming(entry: TrailEntry) {
  renaming.value = entry.key;
  newName.value = entry.name;
  newNameError.value = undefined;
  renameFailure.value = null;
  await nextTick();
  renameForm.value?.[0]?.querySelector("input")?.select();
}

function closeRenaming() {
  renaming.value = null;
  newName.value = "";
  newNameError.value = undefined;
  renameFailure.value = null;
}

async function cancelRenaming() {
  closeRenaming();
  await nextTick();
  (renameButton.value?.[0]?.$el as HTMLElement | undefined)?.focus();
}

async function submitRename(entry: TrailEntry) {
  newNameError.value = validateMealLabel(newName.value) ?? undefined;
  if (newNameError.value) return;
  busy.value = true;
  renameFailure.value = null;
  try {
    await props.rename(entry.meal!.id, newName.value.trim());
    await cancelRenaming();
  } catch (error) {
    renameFailure.value = `Couldn't rename the meal: ${errorMessage(error)}`;
  } finally {
    busy.value = false;
  }
}

// A meal's time ------------------------------------------------------------------

/** "Starts at 19:00 Tokyo time, dinner's usual time." */
function timeText(entry: TrailEntry): string {
  const meal = entry.meal!;
  const at = `Starts at ${mealStart(meal)} ${zoneCity(props.timeZone)} time`;
  if (meal.startTime !== null) return `${at}.`;
  return entry.slot === "other"
    ? `${at}, the usual time.`
    : `${at}, ${entry.name.toLowerCase()}'s usual time.`;
}

async function openRetiming(entry: TrailEntry) {
  closeRenaming();
  retiming.value = entry.key;
  newTime.value = mealStart(entry.meal!);
  newTimeError.value = undefined;
  timeFailure.value = null;
  await nextTick();
  timeForm.value?.[0]?.querySelector("input")?.focus();
}

function closeRetiming() {
  retiming.value = null;
  newTime.value = "";
  newTimeError.value = undefined;
  timeFailure.value = null;
}

async function cancelRetiming() {
  closeRetiming();
  await nextTick();
  (retimeButton.value?.[0]?.$el as HTMLElement | undefined)?.focus();
}

/** Saves the typed time, or, with null, goes back to the slot's usual time. */
async function saveTime(entry: TrailEntry, startTime: string | null) {
  if (startTime !== null && !/^\d{2}:\d{2}$/.test(startTime)) {
    newTimeError.value = "Say when it starts, like 19:30.";
    return;
  }
  busy.value = true;
  timeFailure.value = null;
  try {
    await props.setTime(entry.meal!.id, startTime);
    await cancelRetiming();
  } catch (error) {
    timeFailure.value = `Couldn't change the time: ${errorMessage(error)}`;
  } finally {
    busy.value = false;
  }
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
        <p v-else-if="entry.state.state === 'decided'">
          {{ entry.name }} is decided: {{ entry.state.restaurant }}.
        </p>

        <!-- When it starts, on the trip's clock (#12). -->
        <template v-if="entry.meal !== null">
          <form
            v-if="retiming === entry.key"
            ref="timeForm"
            class="stack-sm"
            novalidate
            @submit.prevent="saveTime(entry, newTime)"
          >
            <TextField
              v-model="newTime"
              :label="`Start time (${zoneCity(timeZone)} time)`"
              type="time"
              step="60"
              :error="newTimeError"
            />
            <p v-if="timeFailure" role="alert" class="error">{{ timeFailure }}</p>
            <div class="actions">
              <BaseButton type="submit" variant="primary" :disabled="busy">Save time</BaseButton>
              <BaseButton
                v-if="entry.meal.startTime !== null"
                :disabled="busy"
                @click="saveTime(entry, null)"
              >
                Use the usual time, {{ DEFAULT_START[entry.slot] }}
              </BaseButton>
              <BaseButton :disabled="busy" @click="cancelRetiming">Cancel</BaseButton>
            </div>
          </form>
          <div v-else class="time">
            <p>{{ timeText(entry) }}</p>
            <BaseButton ref="retimeButton" variant="quiet" @click="openRetiming(entry)">
              <BaseIcon name="pencil-simple" /> Change time
            </BaseButton>
          </div>
        </template>

        <!-- Only an "other" meal has a name of its own to change. -->
        <template v-if="entry.meal !== null && entry.slot === 'other'">
          <form
            v-if="renaming === entry.key"
            ref="renameForm"
            class="stack-sm"
            novalidate
            @submit.prevent="submitRename(entry)"
          >
            <TextField
              v-model="newName"
              label="New name"
              autocomplete="off"
              :maxlength="MAX_MEAL_LABEL_LENGTH + 20"
              :error="newNameError"
            />
            <p v-if="renameFailure" role="alert" class="error">{{ renameFailure }}</p>
            <div class="actions">
              <BaseButton type="submit" variant="primary" :disabled="busy">Save</BaseButton>
              <BaseButton :disabled="busy" @click="cancelRenaming">Cancel</BaseButton>
            </div>
          </form>
          <div v-else>
            <BaseButton ref="renameButton" @click="openRenaming(entry)">
              <BaseIcon name="pencil-simple" /> Rename
            </BaseButton>
          </div>
        </template>

        <!-- The restaurants proposed for it, proposing another (#8), and deciding (#11). -->
        <MealProposals
          v-if="entry.meal !== null"
          :key="entry.meal.id"
          :meal-id="entry.meal.id"
          :meal-name="entry.name"
          :time-zone="timeZone"
          :organiser="organiser"
          @count="(count) => emit('proposalCount', entry.meal!.id, count)"
          @decided="(restaurant) => emit('decided', entry.meal!.id, restaurant)"
        />

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
.time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

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
