<script setup lang="ts">
/*
 * Inline stroke icons, drawn to match Phosphor "regular" names from the
 * ui-ux-pro-max icon data. Decorative by default; pass `label` when the icon
 * carries meaning on its own.
 */
import { computed } from "vue";

type Shape = { d: string } | { cx: number; cy: number; r: number; dash?: string };

const icons = {
  plus: [{ d: "M12 5v14M5 12h14" }],
  check: [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  "check-circle": [{ cx: 12, cy: 12, r: 9 }, { d: "M8 12.5l3 3 5-6" }],
  "circle-dashed": [{ cx: 12, cy: 12, r: 9, dash: "3.5 3" }],
  chats: [
    { d: "M4 4h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" },
    { d: "M16 8h4a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1v3l-4-3h-4a1 1 0 0 1-1-1v-1" },
  ],
  "thumbs-up": [
    {
      d: "M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zM7 10l4-7a2.5 2.5 0 0 1 2.5 2.5V9h5.6a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 17.9 21H7",
    },
  ],
  "thumbs-down": [
    {
      d: "M7 14V3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3zM7 14l4 7a2.5 2.5 0 0 0 2.5-2.5V15h5.6a2 2 0 0 0 2-2.3l-1.2-8A2 2 0 0 0 17.9 3H7",
    },
  ],
  "map-pin": [
    { d: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" },
    { cx: 12, cy: 9.5, r: 2.5 },
  ],
  "fork-knife": [{ d: "M6 3v7a2 2 0 0 0 4 0V3M8 3v18M17 21V3c-2.2 0-4 2.5-4 6v4h4" }],
  sun: [
    { cx: 12, cy: 12, r: 4 },
    {
      d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    },
  ],
  moon: [{ d: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" }],
  "caret-left": [{ d: "M15 5l-7 7 7 7" }],
  "caret-right": [{ d: "M9 5l7 7-7 7" }],
  warning: [{ d: "M12 3l10 18H2L12 3zM12 10v5M12 18v.01" }],
  trash: [{ d: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" }],
  x: [{ d: "M6 6l12 12M18 6L6 18" }],
  "arrow-square-out": [
    { d: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" },
  ],
  calendar: [
    {
      d: "M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10h16M8 3v4M16 3v4",
    },
  ],
  users: [
    { cx: 9, cy: 8, r: 3.5 },
    { d: "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .6 3 3 3 6" },
  ],
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
      <circle v-else :cx="shape.cx" :cy="shape.cy" :r="shape.r" :stroke-dasharray="shape.dash" />
    </template>
  </svg>
</template>
