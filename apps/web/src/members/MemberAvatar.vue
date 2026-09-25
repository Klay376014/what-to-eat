<script setup lang="ts">
/*
 * A member's Google picture, or their initials when there is none or it
 * fails to load. Decorative: the name is always written next to it. Drawn
 * like the header's account avatar (AccountMenu.vue), from the same tokens.
 */
import { computed, ref, watch } from "vue";
import { initialsOf } from "./initials.ts";

const props = withDefaults(
  defineProps<{
    name: string | null;
    avatarUrl: string | null;
    /** Its width and height in CSS pixels. */
    size?: number;
  }>(),
  { size: 36 },
);

const pictureFailed = ref(false);
watch(
  () => props.avatarUrl,
  () => (pictureFailed.value = false),
);
const showPicture = computed(() => Boolean(props.avatarUrl) && !pictureFailed.value);
const initials = computed(() => initialsOf(props.name));
</script>

<template>
  <img
    v-if="showPicture"
    class="avatar"
    :src="avatarUrl!"
    alt=""
    referrerpolicy="no-referrer"
    :width="size"
    :height="size"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @error="pictureFailed = true"
  />
  <span
    v-else
    class="avatar initials"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
    >{{ initials }}</span
  >
</template>

<style scoped>
.avatar {
  flex: none;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--border-strong);
  object-fit: cover;
}

.initials {
  display: grid;
  place-items: center;
  background: var(--avatar-bg);
  color: var(--avatar-fg);
  font-size: var(--text-sm);
  font-weight: var(--strong-weight);
}
</style>
