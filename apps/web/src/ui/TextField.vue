<script setup lang="ts">
/*
 * A labelled input. The hint and the error are wired to the input through
 * aria-describedby, so a screen reader reads them with the field. Any other
 * attribute (autocomplete, maxlength, min) is passed to the <input>.
 */
import { toRef } from "vue";
import { useFieldIds } from "./useFieldIds.ts";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{ label: string; type?: string; hint?: string; error?: string }>(),
  { type: "text", hint: undefined, error: undefined },
);
const model = defineModel<string>({ required: true });
const { id, hintId, errorId, describedBy } = useFieldIds(
  toRef(props, "hint"),
  toRef(props, "error"),
);
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      v-bind="$attrs"
      :type="type"
      class="control"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
    />
    <p v-if="hint" :id="hintId" class="hint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>

<style scoped src="./field.css"></style>
