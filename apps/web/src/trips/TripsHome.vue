<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { pendingCalendarReturn } from "../calendar/calendarConnect.ts";
import TripGrid from "../grid/TripGrid.vue";
import { errorMessage } from "../lib/errors.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import EmptyState from "../ui/EmptyState.vue";
import SelectField from "../ui/SelectField.vue";
import CreateTripForm from "./CreateTripForm.vue";
import EditTripForm from "./EditTripForm.vue";
import { pickDefaultTrip, type Trip } from "./trip.ts";
import { useTripsApi } from "./tripsApi.ts";
// #6: members and invitations.
import TripPeople from "../members/TripPeople.vue";

// #6: the trip an invitation link just joined; opened instead of the default.
const props = defineProps<{ openTripId?: string | null }>();

const api = useTripsApi();

const trips = ref<Trip[]>([]);
const selectedId = ref<string | null>(null);
const loading = ref(true);
const failure = ref<string | null>(null);
const mode = ref<"view" | "create" | "edit">("view");

const selected = computed(() => trips.value.find((t) => t.id === selectedId.value));

async function load() {
  loading.value = true;
  failure.value = null;
  try {
    trips.value = await api.listTrips();
    // #12: back from Google's consent screen, the trip it connects comes first.
    const connecting = pendingCalendarReturn()?.tripId ?? null;
    selectedId.value =
      trips.value.find((t) => t.id === props.openTripId)?.id ??
      trips.value.find((t) => t.id === connecting)?.id ??
      pickDefaultTrip(trips.value, new Date())?.id ??
      null;
  } catch (error) {
    failure.value = `Couldn't load your trips: ${errorMessage(error)}`;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function onCreated(trip: Trip) {
  trips.value = [...trips.value, trip];
  selectedId.value = trip.id;
  mode.value = "view";
}

function onSaved(trip: Trip) {
  trips.value = trips.value.map((t) => (t.id === trip.id ? trip : t));
  mode.value = "view";
}

function onDeleted(tripId: string) {
  trips.value = trips.value.filter((t) => t.id !== tripId);
  selectedId.value = pickDefaultTrip(trips.value, new Date())?.id ?? null;
  mode.value = "view";
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
function formatDate(date: string): string {
  // A trip date is a calendar day, not an instant: format it as that day.
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}
</script>

<template>
  <BaseCard v-if="loading"><p class="muted">Loading your trips…</p></BaseCard>

  <BaseCard v-else-if="failure">
    <p role="alert" class="error">{{ failure }}</p>
    <div><BaseButton @click="load">Try again</BaseButton></div>
  </BaseCard>

  <CreateTripForm
    v-else-if="mode === 'create'"
    :cancellable="true"
    @created="onCreated"
    @cancel="mode = 'view'"
  />

  <EmptyState v-else-if="trips.length === 0" title="No trips yet">
    Create a trip to start deciding where to eat. You'll be its organiser, and can invite the people
    coming along.
    <template #action>
      <BaseButton variant="primary" @click="mode = 'create'">
        <BaseIcon name="plus" /> Create a trip
      </BaseButton>
    </template>
  </EmptyState>

  <div v-else class="stack">
    <BaseCard class="trip-bar">
      <SelectField v-model="selectedId" label="Trip" :disabled="mode === 'edit'">
        <option v-for="trip in trips" :key="trip.id" :value="trip.id">{{ trip.name }}</option>
      </SelectField>
      <BaseButton :disabled="mode === 'edit'" @click="mode = 'create'">
        <BaseIcon name="plus" /> New trip
      </BaseButton>
    </BaseCard>

    <BaseCard v-if="selected" as="article">
      <h2>{{ selected.name }}</h2>
      <dl class="facts">
        <dt>Dates</dt>
        <dd v-if="selected.startDate && selected.endDate">
          {{ formatDate(selected.startDate) }} – {{ formatDate(selected.endDate) }}
        </dd>
        <dd v-else>No dates — for everyday use</dd>
        <dt>Timezone</dt>
        <dd>{{ selected.timezone }}</dd>
        <dt>Organiser</dt>
        <dd v-if="selected.myRole === 'organiser'">You're the organiser</dd>
        <dd v-else>Organised by {{ selected.organiserName ?? "a member with no name" }}</dd>
      </dl>

      <EditTripForm
        v-if="mode === 'edit'"
        :key="selected.id"
        :trip="selected"
        @saved="onSaved"
        @deleted="onDeleted"
        @cancel="mode = 'view'"
      />
      <div v-else-if="selected.myRole === 'organiser'">
        <BaseButton @click="mode = 'edit'"><BaseIcon name="pencil-simple" /> Edit trip</BaseButton>
      </div>
    </BaseCard>

    <!-- The trip grid (#7): the trip's days and their meals. -->
    <TripGrid v-if="selected" :key="selected.id" :trip="selected" />
    <!-- #6: who is in the trip, invitations, leaving and handing over. -->
    <TripPeople
      v-if="selected"
      :key="selected.id"
      :trip="selected"
      @left="onDeleted"
      @changed="onSaved"
    />
  </div>
</template>

<style scoped>
.trip-bar {
  flex-direction: row;
  align-items: flex-end;
  gap: var(--space-2);
}

/* SelectField's root carries this component's scope id, so this reaches its wrapper. */
.trip-bar > .field {
  flex: 1;
  min-width: 0;
}

.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-1) var(--space-4);
}

.facts dt {
  color: var(--muted);
  font-weight: var(--label-weight);
}
</style>
