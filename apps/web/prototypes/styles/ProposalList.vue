<script setup lang="ts">
import { ref } from "vue";
import Avatars from "./Avatars.vue";
import Icon from "./Icon.vue";
import { dinnerProposals, me, member, members, type Proposal } from "./mockTrip.ts";

const proposals = ref<Proposal[]>(structuredClone(dinnerProposals));

function myVote(p: Proposal): 1 | -1 | 0 {
  if (p.up.includes(me)) return 1;
  if (p.down.includes(me)) return -1;
  return 0;
}

/** Tapping your current vote again withdraws it; there is no zero button. */
function vote(p: Proposal, value: 1 | -1) {
  const current = myVote(p);
  p.up = p.up.filter((id) => id !== me);
  p.down = p.down.filter((id) => id !== me);
  if (current === value) return;
  (value === 1 ? p.up : p.down).push(me);
}

function notVoted(p: Proposal): string[] {
  return members.map((m) => m.id).filter((id) => !p.up.includes(id) && !p.down.includes(id));
}
</script>

<template>
  <div class="stack">
    <header class="stack-sm">
      <div class="row-start">
        <button type="button" class="btn btn-icon" aria-label="Back to the trip">
          <Icon name="caret-left" />
        </button>
        <div>
          <p class="muted small">Thu 15 Oct</p>
          <h3 class="title-lg">Dinner</h3>
        </div>
      </div>
      <p class="banner banner-decided">
        <Icon name="check-circle" />
        <span><strong>Decided:</strong> Uobei Shibuya Dogenzaka, by Jun Wu</span>
      </p>
    </header>

    <article
      v-for="p in proposals"
      :key="p.id"
      class="card proposal stack-sm"
      :class="{ 'proposal--decided': p.decided }"
    >
      <div class="row-between align-start">
        <h4 class="proposal-name">{{ p.name }}</h4>
        <span v-if="p.decided" class="badge badge-decided">
          <Icon name="check" :size="16" /> Decided
        </span>
        <span v-else-if="myVote(p) === 0" class="badge badge-pending">Not voted</span>
      </div>
      <p class="muted small">
        Proposed by {{ member(p.proposedBy).name }} ·
        <a href="#" class="link" @click.prevent>
          Open in Google Maps <Icon name="arrow-square-out" :size="16" />
        </a>
      </p>
      <p v-if="p.note" class="note">{{ p.note }}</p>

      <div class="vote-summary">
        <div class="vote-line">
          <span class="vote-count tabular"
            ><Icon name="thumbs-up" :size="18" /> +{{ p.up.length }}</span
          >
          <Avatars v-if="p.up.length" :ids="p.up" label="Voted +1" :max="4" />
          <span v-else class="muted small">No +1 yet</span>
        </div>
        <div class="vote-line">
          <span class="vote-count tabular"
            ><Icon name="thumbs-down" :size="18" /> −{{ p.down.length }}</span
          >
          <Avatars v-if="p.down.length" :ids="p.down" label="Voted −1" :max="4" />
          <span v-else class="muted small">No −1 yet</span>
        </div>
        <p v-if="notVoted(p).length" class="muted small">
          Waiting on
          {{
            notVoted(p)
              .map((id) => member(id).name.split(" ")[0])
              .join(", ")
          }}
        </p>
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn btn-vote btn-vote-up"
          :aria-pressed="myVote(p) === 1"
          @click="vote(p, 1)"
        >
          <Icon name="thumbs-up" /> +1
        </button>
        <button
          type="button"
          class="btn btn-vote btn-vote-down"
          :aria-pressed="myVote(p) === -1"
          @click="vote(p, -1)"
        >
          <Icon name="thumbs-down" /> −1
        </button>
        <button v-if="!p.decided" type="button" class="btn btn-secondary push-end">
          Decide on this
        </button>
      </div>
    </article>

    <button type="button" class="btn btn-primary btn-block">
      <Icon name="plus" /> Propose a restaurant
    </button>
  </div>
</template>
