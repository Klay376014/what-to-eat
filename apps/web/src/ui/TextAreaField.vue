<script setup lang="ts">
/*
 * A labelled multi-line input: TextField's twin for free text such as a
 * proposal's note. Same label, hint and error wiring, same field styles. Any
 * other attribute (maxlength, rows) is passed to the <textarea>.
 */
import { toRef } from "vue";
import { useFieldIds } from "./useFieldIds.ts";

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ label: string; hint?: string; error?: string }>(), {
  hint: undefined,
  error: undefined,
});
const model = defineModel<string>({ required: true });
const { id, hintId, errorId, describedBy } = useFieldIds(
  toRef(props, "hint"),
  toRef(props, "error"),
);
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <textarea
      :id="id"
      v-model="model"
      rows="3"
      v-bind="$attrs"
      class="control"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
    />
    <p v-if="hint" :id="hintId" class="hint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>

<style scoped src="./field.css"></style>
<style scoped>
/* The shared control is sized for one line; a textarea grows downwards. */
textarea.control {
  padding: var(--space-2) var(--space-3);
  resize: vertical;
}
</style>
