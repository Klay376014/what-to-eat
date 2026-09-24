<script setup lang="ts">
/* What a screen shows when there is nothing yet, and the way forward. */
import BaseCard from "./BaseCard.vue";
import BaseIcon, { type IconName } from "./BaseIcon.vue";

withDefaults(defineProps<{ title: string; icon?: IconName }>(), { icon: "map-trifold" });
</script>

<template>
  <BaseCard class="empty-state">
    <span class="art"><BaseIcon :name="icon" :size="40" /></span>
    <h2>{{ title }}</h2>
    <p class="text"><slot /></p>
    <div v-if="$slots.action" class="action"><slot name="action" /></div>
  </BaseCard>
</template>

<style scoped>
.empty-state {
  align-items: center;
  text-align: center;
  padding: calc(var(--space-6) * 2) var(--space-4);
}

.art {
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--muted);
}

.text {
  color: var(--muted);
  max-width: 32rem;
}
</style>
