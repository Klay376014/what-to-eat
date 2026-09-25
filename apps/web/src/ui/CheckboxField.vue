<script setup lang="ts">
/*
 * A labelled checkbox, with an optional hint read with it through
 * aria-describedby. Any other attribute (disabled) is passed to the <input>.
 */
import { ref, toRef } from "vue";
import { useFieldIds } from "./useFieldIds.ts";

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ label: string; hint?: string }>(), {
  hint: undefined,
});
const model = defineModel<boolean>({ required: true });
const { id, hintId, describedBy } = useFieldIds(toRef(props, "hint"), ref());
</script>

<template>
  <div class="checkbox-field">
    <div class="row">
      <input
        :id="id"
        v-model="model"
        v-bind="$attrs"
        type="checkbox"
        class="box"
        :aria-describedby="describedBy"
      />
      <label :for="id">{{ label }}</label>
    </div>
    <p v-if="hint" :id="hintId" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped src="./field.css"></style>
<style scoped>
.checkbox-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

/* A comfortable target without restyling the native control. */
.box {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.125rem;
  accent-color: var(--primary);
}

.box:disabled {
  cursor: not-allowed;
}

.hint {
  padding-left: calc(1.25rem + var(--space-2));
}
</style>
