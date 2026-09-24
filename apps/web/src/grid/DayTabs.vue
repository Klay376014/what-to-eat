<script setup lang="ts">
/*
 * The strip of day tabs (ADR 0003): each tab names its day and sums it up in
 * words. A tablist with one tab stop; the left and right arrow keys (and Home
 * and End) move between days. Tabs share the width down to 44px each; past
 * that the strip scrolls sideways inside itself, never the page, and keeps the
 * selected day in view.
 */
import { nextTick, onMounted, useTemplateRef, watch } from "vue";
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

/** Scrolls the strip, and only the strip, so the selected tab is fully visible. */
function keepActiveInView() {
  const container = strip.value;
  const tab = tabElement(props.active);
  if (!container || !tab) return;
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < container.scrollLeft) container.scrollLeft = left;
  else if (right > container.scrollLeft + container.clientWidth) {
    container.scrollLeft = right - container.clientWidth;
  }
}

onMounted(keepActiveInView);
watch(() => props.active, keepActiveInView, { flush: "post" });

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
  <div ref="strip" class="strip" role="tablist" aria-label="Days" @keydown="onKeydown">
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
</template>

<style scoped>
/* A solid bar, sticky under the header while the day's trail scrolls. Its
   own position makes it the tabs' offsetParent for keepActiveInView. */
.strip {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  background: var(--surface);
  border: var(--card-border-width) solid var(--border-strong);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
}

/* Equal shares of the width, never under 44px: 7 fit at 360px, and past
   that the strip scrolls and cuts the next tab at the edge. */
.tab {
  flex: 1 0 44px;
  min-width: 44px;
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
