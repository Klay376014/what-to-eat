<script setup lang="ts">
/* The production base components (src/ui), shown with the real tokens. */
import { ref } from "vue";
import BaseButton from "../../src/ui/BaseButton.vue";
import BaseCard from "../../src/ui/BaseCard.vue";
import BaseIcon from "../../src/ui/BaseIcon.vue";
import ConfirmDialog from "../../src/ui/ConfirmDialog.vue";
import EmptyState from "../../src/ui/EmptyState.vue";
import SelectField from "../../src/ui/SelectField.vue";
import TextField from "../../src/ui/TextField.vue";

const name = ref("Tokyo, October");
const end = ref("2026-10-12");
const zone = ref("Asia/Tokyo");
const open = ref(false);
</script>

<template>
  <div class="stack">
    <BaseCard>
      <h3>Buttons</h3>
      <div class="actions">
        <BaseButton variant="primary">Create trip</BaseButton>
        <BaseButton>Cancel</BaseButton>
        <BaseButton variant="destructive"><BaseIcon name="trash" /> Delete trip</BaseButton>
        <BaseButton variant="primary" disabled>Saving…</BaseButton>
        <BaseButton variant="quiet"><BaseIcon name="plus" /> Add another meal</BaseButton>
      </div>
    </BaseCard>
    <BaseCard>
      <h3>Fields</h3>
      <TextField v-model="name" label="Trip name" />
      <TextField
        v-model="end"
        label="End date"
        type="date"
        error="The end date can't be before the start date."
      />
      <SelectField
        v-model="zone"
        label="Timezone"
        hint="Every time in the trip is shown in this timezone."
      >
        <option>Asia/Tokyo</option>
        <option>Asia/Taipei</option>
      </SelectField>
    </BaseCard>
    <EmptyState title="No trips yet">
      Create a trip to start deciding where to eat.
      <template #action>
        <BaseButton variant="primary"><BaseIcon name="plus" /> Create a trip</BaseButton>
      </template>
    </EmptyState>
    <BaseCard>
      <h3>Confirmation dialog</h3>
      <div><BaseButton variant="destructive" @click="open = true">Delete trip</BaseButton></div>
    </BaseCard>
    <ConfirmDialog
      :open="open"
      title="Delete “Tokyo, October”?"
      confirm-label="Delete for everyone"
      cancel-label="Keep the trip"
      destructive
      @confirm="open = false"
      @cancel="open = false"
    >
      <p>This removes the trip for every member, and cannot be undone.</p>
    </ConfirmDialog>
  </div>
</template>
