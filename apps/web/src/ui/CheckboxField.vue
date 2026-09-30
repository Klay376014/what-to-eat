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
    <!-- The whole row is the label, so the box and its words are one 44px
         target, not a 20px box (#45). -->
    <label :for="id" class="row">
      <input
        :id="id"
        v-model="model"
        v-bind="$attrs"
        type="checkbox"
        class="box"
        :aria-describedby="describedBy"
      />
      <span>{{ label }}</span>
    </label>
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

/* 44px tall on one line: the padding centres a line of the label in it, and
   a longer label grows from there, its box level with the first line. */
.row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding-block: calc((44px - 1lh) / 2);
  cursor: pointer;
}

/* A comfortable box without restyling the native control. */
.box {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  margin: 0.125rem 0 0;
  accent-color: var(--primary);
}

.box:disabled,
.row:has(.box:disabled) {
  cursor: not-allowed;
}

.hint {
  padding-left: calc(1.25rem + var(--space-2));
}
</style>
