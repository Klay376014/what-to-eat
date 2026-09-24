<script setup lang="ts">
import { computed } from "vue";
import Avatars from "./Avatars.vue";
import Icon from "./Icon.vue";
import MealSlot from "./MealSlot.vue";
import { days, members, trip, type Slot } from "./mockTrip.ts";

const allSlots = computed<Slot[]>(() =>
  days.flatMap((d) => [d.breakfast, d.lunch, d.dinner, ...d.other.map((o) => o.slot)]),
);
const decidedCount = computed(() => allSlots.value.filter((s) => s.state === "decided").length);
</script>

<template>
  <div class="stack">
    <header class="card stack-sm">
      <h3 class="title-lg">{{ trip.name }}</h3>
      <p class="muted meta-line">
        <Icon name="calendar" :size="18" />
        <span>{{ trip.dates }} · {{ trip.timezone }}</span>
      </p>
      <div class="row-between">
        <Avatars :ids="members.map((m) => m.id)" label="Members" />
        <p class="muted small">
          <strong class="tabular">{{ decidedCount }} of {{ allSlots.length }}</strong> meals decided
        </p>
      </div>
    </header>

    <ul class="legend" aria-label="Legend">
      <li class="legend-item slot--empty"><Icon name="plus" :size="16" /> Not planned</li>
      <li class="legend-item slot--discussing"><Icon name="chats" :size="16" /> Discussing</li>
      <li class="legend-item slot--decided"><Icon name="check-circle" :size="16" /> Decided</li>
    </ul>

    <section
      v-for="(day, i) in days"
      :key="day.date"
      class="card day"
      :aria-labelledby="`day-${i}`"
    >
      <h4 :id="`day-${i}`" class="day-title">
        <span>{{ day.weekday }} {{ day.label }}</span>
        <span class="muted small">Day {{ i + 1 }}</span>
      </h4>
      <dl class="slots">
        <div class="slot-row">
          <dt>Breakfast</dt>
          <dd><MealSlot meal="Breakfast" :day="day.label" :slot="day.breakfast" /></dd>
        </div>
        <div class="slot-row">
          <dt>Lunch</dt>
          <dd><MealSlot meal="Lunch" :day="day.label" :slot="day.lunch" /></dd>
        </div>
        <div class="slot-row">
          <dt>Dinner</dt>
          <dd><MealSlot meal="Dinner" :day="day.label" :slot="day.dinner" /></dd>
        </div>
        <div v-for="other in day.other" :key="other.label" class="slot-row">
          <dt>
            <span class="kicker">Other</span>
            {{ other.label }}
          </dt>
          <dd><MealSlot :meal="other.label" :day="day.label" :slot="other.slot" /></dd>
        </div>
      </dl>
      <button type="button" class="btn btn-ghost btn-block">
        <Icon name="plus" /> Add another meal
      </button>
    </section>
  </div>
</template>
