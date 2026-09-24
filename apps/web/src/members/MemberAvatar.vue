<script setup lang="ts">
/*
 * A member's Google picture, or their initials when there is none or it
 * fails to load. Decorative: the name is always written next to it. Drawn
 * like the header's account avatar (AccountMenu.vue), from the same tokens.
 */
import { computed, ref, watch } from "vue";
import { initialsOf } from "./initials.ts";

const props = defineProps<{ name: string | null; avatarUrl: string | null }>();

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
    width="36"
    height="36"
    @error="pictureFailed = true"
  />
  <span v-else class="avatar initials" aria-hidden="true">{{ initials }}</span>
</template>

<style scoped>
.avatar {
  flex: none;
  width: 36px;
  height: 36px;
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
