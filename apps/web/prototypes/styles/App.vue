<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import BaseComponents from "./BaseComponents.vue";
import { audit } from "./contrast.ts";
import EmptyTrips from "./EmptyTrips.vue";
import Icon from "./Icon.vue";
import ProposalList from "./ProposalList.vue";
import { cssVariables, styles, type Mode } from "./styles.ts";
import TripGrid from "./TripGrid.vue";

const params = new URLSearchParams(location.search);
const initialIndex = styles.findIndex((s) => s.id === params.get("style"));
const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;

const index = ref(initialIndex >= 0 ? initialIndex : 0);
const mode = ref<Mode>(
  params.get("mode") === "dark" || params.get("mode") === "light"
    ? (params.get("mode") as Mode)
    : prefersDark
      ? "dark"
      : "light",
);

const style = computed(() => styles[index.value]!);
const results = computed(() => audit(style.value[mode.value]));
const failures = computed(() => results.value.filter((r) => !r.pass));

function step(delta: number) {
  index.value = (index.value + delta + styles.length) % styles.length;
}

watchEffect(() => {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(cssVariables(style.value, mode.value))) {
    root.style.setProperty(key, value);
  }
  root.style.colorScheme = mode.value;
  document.title = `${style.value.name} (${mode.value}) · Style gallery`;
  const url = new URL(location.href);
  url.searchParams.set("style", style.value.id);
  url.searchParams.set("mode", mode.value);
  history.replaceState(null, "", url);
});
</script>

<template>
  <header class="chrome">
    <div class="chrome-inner">
      <button type="button" class="btn btn-icon" aria-label="Previous style" @click="step(-1)">
        <Icon name="caret-left" />
      </button>
      <label class="visually-hidden" for="style-picker">Style</label>
      <select id="style-picker" v-model="index" class="chrome-select">
        <option v-for="(s, i) in styles" :key="s.id" :value="i">{{ i + 1 }}. {{ s.name }}</option>
      </select>
      <button type="button" class="btn btn-icon" aria-label="Next style" @click="step(1)">
        <Icon name="caret-right" />
      </button>
      <button
        type="button"
        class="btn btn-icon"
        :aria-pressed="mode === 'dark'"
        aria-label="Dark mode"
        @click="mode = mode === 'dark' ? 'light' : 'dark'"
      >
        <Icon :name="mode === 'dark' ? 'moon' : 'sun'" />
      </button>
    </div>
  </header>

  <main class="page stack-lg">
    <section class="card stack-sm" aria-labelledby="style-name">
      <p class="kicker">Style {{ index + 1 }} of {{ styles.length }} · {{ mode }}</p>
      <h1 id="style-name" class="title-xl">{{ style.name }}</h1>
      <p class="lead">{{ style.rationale.mood }}</p>
      <h2 class="title-sm">Why it suits this app</h2>
      <ul class="bullets">
        <li v-for="line in style.rationale.why" :key="line">{{ line }}</li>
      </ul>
      <h2 class="title-sm">Trade-offs</h2>
      <ul class="bullets">
        <li v-for="line in style.rationale.tradeoffs" :key="line">{{ line }}</li>
      </ul>
      <h2 class="title-sm">From ui-ux-pro-max</h2>
      <ul class="bullets small">
        <li v-for="line in style.rationale.sources" :key="line">{{ line }}</li>
      </ul>
      <details class="audit">
        <summary>
          Contrast: {{ results.length - failures.length }} of {{ results.length }} pairs pass WCAG
          AA in {{ mode }} mode
        </summary>
        <table class="audit-table">
          <thead>
            <tr>
              <th scope="col">Pair</th>
              <th scope="col">Ratio</th>
              <th scope="col">Needs</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in results" :key="`${r.fg}/${r.bg}`">
              <td>{{ r.fg }} on {{ r.bg }}</td>
              <td class="tabular">{{ r.ratio.toFixed(2) }}</td>
              <td class="tabular">{{ r.min }} {{ r.pass ? "pass" : "FAIL" }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>

    <section class="stack" aria-labelledby="s-grid">
      <h2 id="s-grid" class="section-title">1. Trip grid</h2>
      <TripGrid />
    </section>

    <section class="stack" aria-labelledby="s-proposals">
      <h2 id="s-proposals" class="section-title">2. A meal's proposals</h2>
      <ProposalList />
    </section>

    <section class="stack" aria-labelledby="s-empty">
      <h2 id="s-empty" class="section-title">3. No trips yet</h2>
      <EmptyTrips />
    </section>

    <section class="stack" aria-labelledby="s-base">
      <h2 id="s-base" class="section-title">4. Base components</h2>
      <BaseComponents />
    </section>

    <p class="muted small footer-note">
      Throwaway prototype for issue #19. Not part of the production build.
    </p>
  </main>
</template>
