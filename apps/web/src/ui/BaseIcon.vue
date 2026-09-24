<script setup lang="ts">
/*
 * Inline stroke icons, drawn to match Phosphor "regular" names. Decorative by
 * default (aria-hidden); pass `label` when the icon means something on its own.
 */
import { computed } from "vue";

type Shape = { d: string } | { cx: number; cy: number; r: number };

const icons = {
  plus: [{ d: "M12 5v14M5 12h14" }],
  check: [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  "check-circle": [{ cx: 12, cy: 12, r: 9 }, { d: "M8 12.5l3 3 5-6" }],
  chats: [
    { d: "M4 4h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" },
    { d: "M16 8h4a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1v3l-4-3h-4a1 1 0 0 1-1-1v-1" },
  ],
  "map-trifold": [{ d: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" }],
  "map-pin": [
    { d: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" },
    { cx: 12, cy: 9.5, r: 2.5 },
  ],
  "fork-knife": [{ d: "M6 3v7a2 2 0 0 0 4 0V3M8 3v18M17 21V3c-2.2 0-4 2.5-4 6v4h4" }],
  warning: [{ d: "M12 3l10 18H2L12 3zM12 10v5M12 18v.01" }],
  trash: [{ d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" }],
  "sign-out": [{ d: "M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M16 16l4-4-4-4M20 12H9" }],
  "pencil-simple": [{ d: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" }],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof icons;

const props = withDefaults(defineProps<{ name: IconName; size?: number; label?: string }>(), {
  size: 20,
  label: undefined,
});

const shapes = computed<Shape[]>(() => icons[props.name]);
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <template v-for="(shape, i) in shapes" :key="i">
      <path v-if="'d' in shape" :d="shape.d" />
      <circle v-else :cx="shape.cx" :cy="shape.cy" :r="shape.r" />
    </template>
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  stroke-width: var(--icon-stroke);
}
</style>
