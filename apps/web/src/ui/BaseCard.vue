<script setup lang="ts">
/* A solid surface. Text always sits on a card or another solid surface,
 * never on the textured page backdrop (ADR 0002). */
withDefaults(defineProps<{ as?: string }>(), { as: "section" });
</script>

<template>
  <component :is="as" class="card">
    <slot />
  </component>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-4);
  background: var(--surface);
  border: var(--card-border-width) solid var(--border-strong);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}
</style>
