<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import type { Slot } from "./mockTrip.ts";

const props = defineProps<{ meal: string; day: string; slot: Slot }>();

const description = computed(() => {
  const s = props.slot;
  if (s.state === "empty") return "not planned yet. Propose a restaurant";
  if (s.state === "discussing") {
    const n = `${s.proposals} ${s.proposals === 1 ? "proposal" : "proposals"}`;
    return s.awaitingMe ? `${n}, waiting for your vote` : n;
  }
  return `decided: ${s.restaurant}`;
});
</script>

<template>
  <button
    type="button"
    class="slot"
    :class="`slot--${slot.state}`"
    :aria-label="`${meal}, ${day}: ${description}`"
  >
    <template v-if="slot.state === 'empty'">
      <Icon name="plus" />
      <span class="slot-text">Not planned</span>
    </template>
    <template v-else-if="slot.state === 'discussing'">
      <Icon name="chats" />
      <span class="slot-text">
        {{ slot.proposals }} {{ slot.proposals === 1 ? "proposal" : "proposals" }}
      </span>
      <span v-if="slot.awaitingMe" class="slot-flag">Your vote</span>
    </template>
    <template v-else>
      <Icon name="check-circle" />
      <span class="slot-text slot-name">{{ slot.restaurant }}</span>
    </template>
  </button>
</template>
