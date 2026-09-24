<script setup lang="ts">
/*
 * #19 phase 2 gallery: the chosen Cartographer tokens (the production
 * tokens.css) and the #7 grid layout study. Throwaway, dev only.
 */
import { computed, ref, watchEffect } from "vue";
import BaseButton from "../../src/ui/BaseButton.vue";
import BaseCard from "../../src/ui/BaseCard.vue";
import BaseIcon from "../../src/ui/BaseIcon.vue";
import BaseSheet from "./BaseSheet.vue";
import LayoutCards from "./LayoutCards.vue";
import LayoutDayTabs from "./LayoutDayTabs.vue";
import LayoutMatrix from "./LayoutMatrix.vue";
import { layouts } from "./layouts.ts";
import TripSummary from "./TripSummary.vue";

type View = (typeof layouts)[number]["id"] | "components";

const params = new URLSearchParams(location.search);
const views: View[] = ["cards", "matrix", "tabs", "components"];
const view = ref<View>(views.find((v) => v === params.get("layout")) ?? "cards");
const dark = ref(
  params.get("mode")
    ? params.get("mode") === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches,
);
const note = computed(() => layouts.find((l) => l.id === view.value));

watchEffect(() => {
  document.documentElement.dataset.theme = dark.value ? "dark" : "light";
  const url = new URL(location.href);
  url.searchParams.set("layout", view.value);
  url.searchParams.set("mode", dark.value ? "dark" : "light");
  history.replaceState(null, "", url);
});
</script>

<template>
  <header class="chrome">
    <div class="chrome-inner">
      <label class="visually-hidden" for="view-picker">Show</label>
      <select id="view-picker" v-model="view" class="picker">
        <option v-for="l in layouts" :key="l.id" :value="l.id">{{ l.name }}</option>
        <option value="components">Base components</option>
      </select>
      <BaseButton :aria-pressed="dark" aria-label="Dark mode" @click="dark = !dark">
        <BaseIcon :name="dark ? 'moon' : 'sun'" />
      </BaseButton>
    </div>
  </header>

  <main class="page stack">
    <BaseCard v-if="note">
      <p class="muted small">#7 grid layout study · Cartographer · no layout chosen yet</p>
      <h1>{{ note.name }}</h1>
      <p>{{ note.summary }}</p>
      <h2 class="note-head">Seeing the gaps across the trip at 360px</h2>
      <p>{{ note.gaps }}</p>
      <h2 class="note-head">For</h2>
      <ul class="bullets">
        <li v-for="line in note.pros" :key="line">{{ line }}</li>
      </ul>
      <h2 class="note-head">Against</h2>
      <ul class="bullets">
        <li v-for="line in note.cons" :key="line">{{ line }}</li>
      </ul>
    </BaseCard>
    <BaseCard v-else>
      <h1>Base components</h1>
      <p>The production components from src/ui, with the production tokens.</p>
    </BaseCard>

    <template v-if="note">
      <TripSummary />
      <LayoutCards v-if="view === 'cards'" />
      <LayoutMatrix v-else-if="view === 'matrix'" />
      <LayoutDayTabs v-else />
    </template>
    <BaseSheet v-else />
  </main>
</template>

<style scoped>
.chrome {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--surface);
  border-bottom: var(--border-width) solid var(--border-strong);
}

.chrome-inner,
.page {
  max-width: 40rem;
  margin: 0 auto;
}

.chrome-inner {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
}

.picker {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--space-3);
  background: var(--surface);
  color: var(--text);
  border: var(--control-border-width) solid var(--border-strong);
  border-radius: var(--radius-control);
}

.page {
  padding: var(--space-4) var(--space-4) calc(var(--space-6) * 2);
}

.note-head {
  font-size: var(--text-base);
}

.small {
  font-size: var(--text-sm);
}

.bullets {
  padding-left: 1.25rem;
}
</style>
