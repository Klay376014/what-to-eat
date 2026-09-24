<script setup lang="ts">
/*
 * The one button. `variant` sets its weight: one primary per screen,
 * secondary for everything else, destructive for actions that remove things.
 * Defaults to type="button" so it never submits a form by accident.
 */
withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "destructive" | "quiet";
    type?: "button" | "submit";
    disabled?: boolean;
    block?: boolean;
  }>(),
  { variant: "secondary", type: "button", disabled: false, block: false },
);
const emit = defineEmits<{ click: [event: MouseEvent] }>();

function press(event: MouseEvent) {
  // A disabled <button> should never get here; guard anyway, since a
  // synthetic event can still reach the listener in some environments.
  if ((event.currentTarget as HTMLButtonElement | null)?.disabled) return;
  emit("click", event);
}
</script>

<template>
  <button
    :type="type"
    class="button"
    :class="[`button--${variant}`, { 'button--block': block }]"
    :disabled="disabled"
    @click="press"
  >
    <slot />
  </button>
</template>

<style scoped>
.button {
  min-height: 44px;
  min-width: 44px;
  padding: var(--space-2) var(--space-4);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: var(--control-border-width) solid transparent;
  border-radius: var(--radius-button);
  box-shadow: var(--shadow-button);
  font-weight: var(--label-weight);
  text-align: center;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    transform var(--transition),
    background-color var(--transition);
}

.button:active:not(:disabled) {
  transform: scale(0.98);
}

.button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.button--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.button--secondary {
  background: var(--secondary);
  border-color: var(--secondary-border);
  color: var(--on-secondary);
}

.button--destructive {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--on-danger);
}

.button--quiet {
  background: transparent;
  color: var(--link);
}

.button--block {
  width: 100%;
}
</style>
