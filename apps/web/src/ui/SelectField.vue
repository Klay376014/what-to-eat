<script setup lang="ts">
/* A labelled <select>; options go in the default slot. See TextField. */
import { toRef } from "vue";
import { useFieldIds } from "./useFieldIds.ts";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{ label: string; hint?: string; error?: string; disabled?: boolean }>(),
  { hint: undefined, error: undefined, disabled: false },
);
const model = defineModel<string | null>({ required: true });
const { id, hintId, errorId, describedBy } = useFieldIds(
  toRef(props, "hint"),
  toRef(props, "error"),
);
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <select
      :id="id"
      v-model="model"
      v-bind="$attrs"
      class="control"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
    >
      <slot />
    </select>
    <p v-if="hint" :id="hintId" class="hint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>

<style scoped src="./field.css"></style>
