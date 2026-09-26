<script setup lang="ts">
/*
 * The nudge (#16): emails the trip's members with no vote on this meal,
 * never the one pressing it, at most once per meal every six hours. It says
 * who has not voted; during the cooldown the button says how long is left
 * rather than silently doing nothing. Not shown on a decided meal or one
 * with nothing to vote on; where everyone else has voted it says so instead.
 *
 * The cooldown and who may nudge are the database's to enforce
 * (public.nudge_meal, 20261002090000_nudges.sql); this only reflects them.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { errorMessage } from "../lib/errors.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import { formatCooldown, NUDGE_COOLDOWN_MS, nudgeOffer } from "./nudge.ts";
import { NudgeRefusedError, useProposalsApi, type NudgeState } from "./proposalsApi.ts";
import type { Vote } from "./vote.ts";

const props = defineProps<{
  mealId: string;
  decided: boolean;
  proposals: readonly { votes: readonly Vote[] }[];
}>();

const api = useProposalsApi();
const state = ref<NudgeState | null>(null);
const busy = ref(false);
const sent = ref<string | null>(null);
const failure = ref<string | null>(null);

/** This device's clock, moved on often enough for the minutes left to stay right. */
const now = ref(new Date());
let ticker: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  ticker = setInterval(() => (now.value = new Date()), 15_000);
  try {
    state.value = await api.getNudgeState(props.mealId);
  } catch {
    // The nudge is a convenience: without its state it is simply not offered.
  }
});
onUnmounted(() => clearInterval(ticker));

const offer = computed(() =>
  state.value
    ? nudgeOffer({
        decided: props.decided,
        proposals: props.proposals,
        members: state.value.members,
        meId: state.value.meId,
        lastNudgedAt: state.value.lastNudgedAt,
        now: now.value,
      })
    : null,
);

const names = (people: readonly { name: string | null }[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(
    people.map((p) => p.name ?? "someone with no name"),
  );

/** "Carol and Frank haven't voted yet." */
const waitingLine = computed(() => {
  if (!offer.value || offer.value.kind === "unavailable") return null;
  const waiting = offer.value.waiting;
  return `${names(waiting)} ${waiting.length === 1 ? "hasn't" : "haven't"} voted yet.`;
});

async function nudge() {
  if (!state.value || offer.value?.kind !== "ready") return;
  const reached = offer.value.waiting;
  busy.value = true;
  sent.value = failure.value = null;
  try {
    const at = await api.nudge(props.mealId);
    state.value = { ...state.value, lastNudgedAt: at };
    now.value = new Date();
    sent.value = `Nudged ${names(reached)} by email.`;
  } catch (error) {
    if (error instanceof NudgeRefusedError && error.reason === "cooldown" && error.availableAt) {
      const last = new Date(Date.parse(error.availableAt) - NUDGE_COOLDOWN_MS).toISOString();
      state.value = { ...state.value, lastNudgedAt: last };
      now.value = new Date();
      failure.value = "Someone nudged this meal in the last six hours, so yours was not sent.";
    } else if (error instanceof NudgeRefusedError) {
      failure.value = `${error.message} Your nudge was not sent.`;
    } else {
      failure.value = `Couldn't nudge: ${errorMessage(error)}`;
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    v-if="offer && !(offer.kind === 'unavailable' && offer.reason !== 'everyone-voted')"
    class="nudge stack-sm"
    aria-label="Nudge"
  >
    <p v-if="offer.kind === 'unavailable'" class="muted">
      Everyone else has voted, so there's nobody to nudge.
    </p>
    <template v-else>
      <p>{{ waitingLine }}</p>
      <div class="actions">
        <BaseButton :disabled="busy || offer.kind === 'cooldown'" @click="nudge">
          <BaseIcon name="bell" />
          {{
            offer.kind === "cooldown"
              ? `Nudge again in ${formatCooldown(offer.remainingMs)}`
              : "Nudge them"
          }}
        </BaseButton>
      </div>
      <p v-if="offer.kind === 'cooldown'" class="hint">
        A meal can be nudged once every six hours.
      </p>
    </template>
    <p v-if="sent" role="status" class="hint">{{ sent }}</p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
  </section>
</template>

<style scoped>
.nudge {
  padding-top: var(--space-2);
}
</style>
