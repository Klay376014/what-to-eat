<script setup lang="ts">
import { computed } from "vue";
import { member } from "./mockTrip.ts";

const props = withDefaults(defineProps<{ ids: string[]; label: string; max?: number }>(), {
  max: 5,
});

const shown = computed(() => props.ids.slice(0, props.max).map(member));
const hidden = computed(() => props.ids.slice(props.max).map(member));
const names = computed(() => props.ids.map((id) => member(id).name).join(", "));
</script>

<template>
  <ul class="avatars" :aria-label="`${label}: ${names || 'nobody'}`">
    <li v-for="m in shown" :key="m.id" class="avatar" :title="m.name" aria-hidden="true">
      {{ m.initials }}
    </li>
    <li v-if="hidden.length" class="avatar avatar-more" aria-hidden="true">+{{ hidden.length }}</li>
  </ul>
</template>
