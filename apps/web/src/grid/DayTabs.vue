<script setup lang="ts">
/*
 * The strip of day tabs (ADR 0003): each tab names its day and sums it up in
 * words. A tablist with one tab stop; the left and right arrow keys (and Home
 * and End) move between days. Tabs share the width down to their own content,
 * and never under 44px; past that the strip scrolls sideways inside itself,
 * never the page, and keeps the selected day in view. Each edge it can still
 * scroll to shows a cue that more days follow (#48).
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, useTemplateRef, watch } from "vue";
import BaseIcon from "../ui/BaseIcon.vue";
import type { IsoDate } from "../trips/trip.ts";
import { formatDay } from "./meal.ts";
import type { DayTab } from "./tripDays.ts";

const props = defineProps<{
  tabs: readonly DayTab[];
  active: IsoDate;
  /** Prefix for each tab's id, so the panel can name the tab that labels it. */
  idPrefix: string;
  panelId: string;
}>();
const emit = defineEmits<{ select: [date: IsoDate] }>();

const strip = useTemplateRef<HTMLElement>("strip");

function tabId(date: IsoDate) {
  return `${props.idPrefix}-${date}`;
}

function tabElement(date: IsoDate): HTMLElement | null {
  return strip.value?.querySelector<HTMLElement>(`[data-date="${date}"]`) ?? null;
}

/** How wide each edge's cue is, in px; the CSS takes it from here. */
const EDGE_CUE = 32;

/**
 * Whether the strip can scroll further before or after what shows (#48).
 * A strip's edge used to show more days only when a tab happened to be cut
 * there; a tab boundary landing on the edge hid that there were more.
 */
const more = reactive({ before: false, after: false });

function measure() {
  const container = strip.value;
  if (!container) return;
  // A pixel of slack: scroll positions can be fractional.
  more.before = container.scrollLeft > 1;
  more.after = container.scrollLeft + container.clientWidth < container.scrollWidth - 1;
}

/**
 * Scrolls the strip, and only the strip, so the selected tab is fully
 * visible and clear of the edge cues: on opening, on selecting, and when
 * sizes change. At either end the strip cannot scroll further, so the tab
 * sits at the edge, where no cue shows. Scrolling by hand is left alone.
 */
function keepActiveInView() {
  const container = strip.value;
  const tab = tabElement(props.active);
  if (!container || !tab) return;
  const left = tab.offsetLeft - EDGE_CUE;
  const right = tab.offsetLeft + tab.offsetWidth + EDGE_CUE;
  if (left < container.scrollLeft) container.scrollLeft = Math.max(0, left);
  else if (right > container.scrollLeft + container.clientWidth) {
    container.scrollLeft = right - container.clientWidth;
  }
  measure();
}

// Sizes change under the strip without a selection: the screen narrows, a
// day's summary widens its tab, a web font arrives. Each puts the selected
// tab back clear of the cues and measures them again.
let sizes: ResizeObserver | null = null;

function observeSizes() {
  const container = strip.value;
  if (!sizes || !container) return;
  sizes.disconnect();
  sizes.observe(container);
  for (const tab of container.querySelectorAll('[role="tab"]')) sizes.observe(tab);
}

onMounted(() => {
  keepActiveInView();
  sizes = new ResizeObserver(keepActiveInView);
  observeSizes();
});
onBeforeUnmount(() => sizes?.disconnect());
watch(() => props.active, keepActiveInView, { flush: "post" });
watch(
  () => props.tabs,
  () => {
    observeSizes();
    keepActiveInView();
  },
  { deep: true, flush: "post" },
);

async function onKeydown(event: KeyboardEvent) {
  const index = props.tabs.findIndex((t) => t.date === props.active);
  const last = props.tabs.length - 1;
  const target = {
    ArrowRight: index === last ? 0 : index + 1,
    ArrowLeft: index === 0 ? last : index - 1,
    Home: 0,
    End: last,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  const date = props.tabs[target]!.date;
  emit("select", date);
  await nextTick();
  tabElement(date)?.focus();
}
</script>

<template>
  <!-- The frame is the sticky bar; the strip scrolls inside it, under the cues. -->
  <div
    class="strip-frame"
    :class="{ 'more-before': more.before, 'more-after': more.after }"
    :style="{ '--edge-cue': `${EDGE_CUE}px` }"
  >
    <div
      ref="strip"
      class="strip"
      role="tablist"
      aria-label="Days"
      @keydown="onKeydown"
      @scroll.passive="measure"
    >
      <button
        v-for="tab in tabs"
        :id="tabId(tab.date)"
        :key="tab.date"
        type="button"
        role="tab"
        class="tab"
        :data-date="tab.date"
        :aria-selected="tab.date === active ? 'true' : 'false'"
        :aria-controls="panelId"
        :tabindex="tab.date === active ? 0 : -1"
        @click="emit('select', tab.date)"
      >
        <!-- The leading spaces keep the accessible name "Sat 3 Oct 2 gaps"; a
           space at the start of a line does not show. -->
        <span class="weekday">{{ tab.isToday ? "Today" : formatDay(tab.date).weekday }}</span>
        <span class="date">{{ ` ${formatDay(tab.date).date}` }}</span>
        <span class="summary">{{ ` ${tab.summary.text}` }}</span>
      </button>
    </div>
    <!-- Decoration: the tabs say which days there are; these only show that
         more scroll into view. They let taps through to the tabs beneath. -->
    <span class="edge edge--before" aria-hidden="true"><BaseIcon name="caret-left" /></span>
    <span class="edge edge--after" aria-hidden="true"><BaseIcon name="caret-right" /></span>
  </div>
</template>

<style scoped>
/* A solid bar, sticky under the header while the day's trail scrolls. It
   clips the strip to its rounded corners and holds the edge cues. */
.strip-frame {
  position: sticky;
  top: 0;
  z-index: 1;
  overflow: hidden;
  background: var(--surface);
  border: var(--card-border-width) solid var(--border-strong);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

/* Its own position makes it the tabs' offsetParent for keepActiveInView. */
.strip {
  position: relative;
  display: flex;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}

/* More days that way (#48): the tabs fade out under a caret at each edge the
   strip can still scroll to. The caret's shape says it, not a colour alone
   (ADR 0002). Taps pass through to the tab beneath. */
.edge {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--edge-cue);
  display: flex;
  align-items: center;
  color: var(--text);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition);
}

.edge--before {
  left: 0;
  justify-content: flex-start;
  background: linear-gradient(to right, var(--surface) 25%, transparent);
}

.edge--after {
  right: 0;
  justify-content: flex-end;
  background: linear-gradient(to left, var(--surface) 25%, transparent);
}

.more-before .edge--before,
.more-after .edge--after {
  opacity: 1;
}

/* Shares of the width, never under 44px (the flex basis) nor under the tab's
   widest line, so "10 Oct" and "3 gaps" never break and the strip keeps to
   three lines (#44). Past that the strip scrolls, and the edge cues show
   which way (#48). */
.tab {
  flex: 1 0 44px;
  min-width: max-content;
  min-height: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-2) var(--space-1);
  border: var(--control-border-width) solid transparent;
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
  touch-action: manipulation;
}

.date {
  font-weight: var(--label-weight);
}

.summary {
  color: var(--muted);
}

/* Selected: a different fill and weight, and aria-selected for assistive
   technology. Never colour alone. */
.tab[aria-selected="true"] {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
  font-weight: var(--strong-weight);
}

.tab[aria-selected="true"] .summary {
  color: var(--on-primary);
}

/* The focus ring sits inside, so the strip's overflow cannot clip it. On the
   selected tab's fill it takes the fill's text colour, which contrasts with
   it (--focus can be the same blue as --primary). */
.tab:focus-visible {
  outline-offset: calc(-1 * var(--focus-width) - 2px);
}

.tab[aria-selected="true"]:focus-visible {
  outline-color: var(--on-primary);
}
</style>
