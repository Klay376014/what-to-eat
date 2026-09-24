<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import { errorMessage } from "../lib/errors.ts";
import CreateTripForm from "./CreateTripForm.vue";
import EditTripForm from "./EditTripForm.vue";
import { pickDefaultTrip, type Trip } from "./trip.ts";
import { useTripsApi } from "./tripsApi.ts";

const api = useTripsApi();
const id = useId();

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
    selectedId.value = pickDefaultTrip(trips.value, new Date())?.id ?? null;
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
  <p v-if="loading" class="muted">Loading your trips…</p>

  <div v-else-if="failure" class="stack">
    <p role="alert" class="error">{{ failure }}</p>
    <button type="button" @click="load">Try again</button>
  </div>

  <CreateTripForm
    v-else-if="mode === 'create'"
    :cancellable="true"
    @created="onCreated"
    @cancel="mode = 'view'"
  />

  <section v-else-if="trips.length === 0" class="empty-state stack">
    <h2>No trips yet</h2>
    <p>
      Create a trip to start deciding where to eat. You'll be its organiser, and can invite the
      people coming along.
    </p>
    <div>
      <button type="button" class="primary" @click="mode = 'create'">Create a trip</button>
    </div>
  </section>

  <div v-else class="stack">
    <div class="trip-bar">
      <div class="field">
        <label :for="`${id}-trip`">Trip</label>
        <select :id="`${id}-trip`" v-model="selectedId" :disabled="mode === 'edit'">
          <option v-for="trip in trips" :key="trip.id" :value="trip.id">{{ trip.name }}</option>
        </select>
      </div>
      <button type="button" :disabled="mode === 'edit'" @click="mode = 'create'">New trip</button>
    </div>

    <article v-if="selected" class="card stack">
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
        <button type="button" @click="mode = 'edit'">Edit trip</button>
      </div>
    </article>
  </div>
</template>
