<script setup lang="ts">
/*
 * A modal confirmation on the native <dialog>. The parent owns `open`; the
 * dialog only reports `confirm` or `cancel`. Escape (or the platform's own
 * cancel request, like Android back) cancels. Opening focuses the safe
 * choice; closing returns focus to whatever had it before.
 */
import { nextTick, onBeforeUnmount, useId, useTemplateRef, watch } from "vue";
import BaseButton from "./BaseButton.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
    busy?: boolean;
  }>(),
  { cancelLabel: "Cancel", destructive: false, busy: false },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const id = useId();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const cancelButton = useTemplateRef<InstanceType<typeof BaseButton>>("cancelButton");
let returnFocusTo: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      if (dialog.value && !dialog.value.open) dialog.value.showModal();
      (cancelButton.value?.$el as HTMLElement | undefined)?.focus();
    } else {
      restoreFocus();
    }
  },
  { immediate: true },
);

onBeforeUnmount(restoreFocus);

function restoreFocus() {
  const target = returnFocusTo;
  returnFocusTo = null;
  if (target?.isConnected) void nextTick(() => target.focus());
}

function cancel() {
  if (!props.busy) emit("cancel");
}
</script>

<template>
  <dialog
    v-if="open"
    ref="dialog"
    class="dialog"
    role="alertdialog"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-body`"
    @keydown.esc.prevent="cancel"
    @cancel.prevent="cancel"
  >
    <h2 :id="`${id}-title`" class="title">{{ title }}</h2>
    <div :id="`${id}-body`" class="body">
      <slot />
    </div>
    <div class="choices">
      <BaseButton ref="cancelButton" :disabled="busy" @click="cancel">
        {{ cancelLabel }}
      </BaseButton>
      <BaseButton
        :variant="destructive ? 'destructive' : 'primary'"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </BaseButton>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(28rem, calc(100vw - 2 * var(--space-4)));
  max-height: calc(100dvh - 2 * var(--space-4));
  overflow-y: auto;
  padding: var(--space-6);
  background: var(--surface);
  color: var(--text);
  border: var(--card-border-width) solid var(--border-strong);
  border-radius: var(--radius-dialog);
  box-shadow: var(--shadow-dialog);
}

.dialog::backdrop {
  background: var(--scrim);
}

.title {
  font-size: var(--text-xl);
  margin-bottom: var(--space-3);
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.body :deep(ul) {
  padding-left: 1.25rem;
}

.choices {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-6);
}
</style>
