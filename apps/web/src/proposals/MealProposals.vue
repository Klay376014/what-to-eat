<script setup lang="ts">
/*
 * A meal's proposals (#8): the restaurants put forward for it, who proposed
 * each and when, and a form to propose another. The proposer can edit the
 * name and note of their own; once anyone has voted, the name is read-only
 * and the form says why. Nothing offers deleting: proposals are never deleted.
 *
 * Each proposal also carries the votes on it (#10): +1 or −1, who voted
 * which way, and a mark on the ones you have not voted on yet. Pressing your
 * own vote again withdraws it; there is no abstain button, since no vote is
 * no opinion.
 *
 * Which buttons appear is for convenience only. Who may propose, edit and
 * vote, and the name lock, are enforced by the database
 * (supabase/migrations/20260926090000_proposals.sql, 20260927090000_votes.sql).
 */
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from "vue";
import { errorMessage } from "../lib/errors.ts";
import MemberAvatar from "../members/MemberAvatar.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import TextAreaField from "../ui/TextAreaField.vue";
import TextField from "../ui/TextField.vue";
import {
  MAX_LINK_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PLACE_NAME_LENGTH,
  formatProposedAt,
  mapsUrl,
  optionalText,
  proposerLabel,
  validateMapsLink,
  validateNote,
  validatePlaceName,
  type Proposal,
} from "./proposal.ts";
import { NameLockedError, useProposalsApi } from "./proposalsApi.ts";
import { myVote, tally, unvotedByMe, voterLabel, type Vote, type VoteValue } from "./vote.ts";

const props = defineProps<{
  mealId: string;
  /** "Dinner", "Afternoon tea". */
  mealName: string;
  /** The trip's timezone: when a proposal was made is shown on its clock. */
  timeZone: string;
}>();
const emit = defineEmits<{
  /** How many proposals the meal has, whenever that is learnt anew. */
  count: [proposals: number];
}>();

const api = useProposalsApi();
const headingId = useId();

const proposals = ref<Proposal[]>([]);
const loading = ref(true);
const loadFailure = ref<string | null>(null);
const busy = ref(false);

async function load() {
  loading.value = true;
  loadFailure.value = null;
  try {
    proposals.value = await api.listProposals(props.mealId);
    emit("count", proposals.value.length);
  } catch (error) {
    loadFailure.value = `Couldn't load the proposals: ${errorMessage(error)}`;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// Proposing -------------------------------------------------------------------

const proposing = ref(false);
const link = ref("");
const name = ref("");
const note = ref("");
const linkError = ref<string | undefined>(undefined);
const nameError = ref<string | undefined>(undefined);
const noteError = ref<string | undefined>(undefined);
const proposeFailure = ref<string | null>(null);
const proposeForm = useTemplateRef<HTMLFormElement>("proposeForm");
const proposeButton = useTemplateRef<InstanceType<typeof BaseButton>>("proposeButton");

async function openProposing() {
  closeEditing();
  proposing.value = true;
  await nextTick();
  proposeForm.value?.querySelector("input")?.focus();
}

function closeProposing() {
  proposing.value = false;
  link.value = "";
  name.value = "";
  note.value = "";
  linkError.value = nameError.value = noteError.value = undefined;
  proposeFailure.value = null;
}

async function cancelProposing() {
  closeProposing();
  await nextTick();
  (proposeButton.value?.$el as HTMLElement | undefined)?.focus();
}

async function submitProposal() {
  linkError.value = validateMapsLink(link.value) ?? undefined;
  nameError.value = validatePlaceName(name.value) ?? undefined;
  noteError.value = validateNote(note.value) ?? undefined;
  if (linkError.value || nameError.value || noteError.value) return;

  busy.value = true;
  proposeFailure.value = null;
  try {
    const created = await api.propose({
      mealId: props.mealId,
      placeName: name.value.trim(),
      sourceUrl: optionalText(link.value),
      note: optionalText(note.value),
    });
    proposals.value = [...proposals.value, created];
    emit("count", proposals.value.length);
    await cancelProposing();
  } catch (error) {
    proposeFailure.value = `Couldn't propose it: ${errorMessage(error)}`;
  } finally {
    busy.value = false;
  }
}

// Editing your own ------------------------------------------------------------

const editing = ref<string | null>(null);
const editName = ref("");
const editNote = ref("");
const editNameError = ref<string | undefined>(undefined);
const editNoteError = ref<string | undefined>(undefined);
const editFailure = ref<string | null>(null);
const editForm = useTemplateRef<HTMLFormElement[]>("editForm");
const editButton = useTemplateRef<InstanceType<typeof BaseButton>[]>("editButton");

async function openEditing(proposal: Proposal) {
  closeProposing();
  editing.value = proposal.id;
  editName.value = proposal.placeName;
  editNote.value = proposal.note ?? "";
  editNameError.value = editNoteError.value = undefined;
  editFailure.value = null;
  await nextTick();
  editForm.value?.[0]?.querySelector<HTMLElement>("input, textarea")?.focus();
}

function closeEditing() {
  editing.value = null;
  editFailure.value = null;
  editNameError.value = editNoteError.value = undefined;
}

async function cancelEditing() {
  closeEditing();
  await nextTick();
  (editButton.value?.[0]?.$el as HTMLElement | undefined)?.focus();
}

function replace(updated: Proposal) {
  proposals.value = proposals.value.map((p) => (p.id === updated.id ? updated : p));
}

async function submitEdit(proposal: Proposal) {
  editNameError.value = proposal.nameLocked
    ? undefined
    : (validatePlaceName(editName.value) ?? undefined);
  editNoteError.value = validateNote(editNote.value) ?? undefined;
  if (editNameError.value || editNoteError.value) return;

  busy.value = true;
  editFailure.value = null;
  try {
    replace(
      await api.editProposal(proposal.id, {
        ...(proposal.nameLocked ? {} : { placeName: editName.value.trim() }),
        note: optionalText(editNote.value),
      }),
    );
    await cancelEditing();
  } catch (error) {
    if (error instanceof NameLockedError) {
      // Someone voted while the name was being edited: show it locked, and
      // keep the typed note for saving again.
      replace({ ...proposal, nameLocked: true });
      editName.value = proposal.placeName;
      editFailure.value =
        "Someone voted on it just now, so the name can no longer change. Your note was not saved either; save it again.";
    } else {
      editFailure.value = `Couldn't save it: ${errorMessage(error)}`;
    }
  } finally {
    busy.value = false;
  }
}

// Voting ----------------------------------------------------------------------

const VOTE_CHOICES = [
  { value: 1, label: "+1" },
  { value: -1, label: "−1" },
] as const satisfies readonly { value: VoteValue; label: string }[];

/** The proposal whose vote is being saved; its buttons wait meanwhile. */
const voting = ref<string | null>(null);
const voteFailure = ref<{ proposalId: string; message: string } | null>(null);

const voteSummary = computed(() => {
  const total = proposals.value.length;
  const unvoted = unvotedByMe(proposals.value);
  if (unvoted === 0) return "You've voted on every proposal.";
  return `You haven't voted on ${unvoted} of ${total} proposal${total === 1 ? "" : "s"}.`;
});

/** Who voted for and against, each side left out when nobody is on it. */
function sides(proposal: Proposal): { word: string; votes: Vote[] }[] {
  const { for: supporters, against } = tally(proposal.votes);
  return [
    { word: "for", votes: supporters },
    { word: "against", votes: against },
  ].filter((side) => side.votes.length > 0);
}

/** Votes one way, changes the vote, or withdraws it when it is already that way. */
async function castVote(proposal: Proposal, value: VoteValue) {
  voting.value = proposal.id;
  voteFailure.value = null;
  try {
    replace(
      myVote(proposal.votes) === value
        ? await api.withdrawVote(proposal.id)
        : await api.vote(proposal.id, value),
    );
  } catch (error) {
    voteFailure.value = {
      proposalId: proposal.id,
      message: `Couldn't save your vote: ${errorMessage(error)}`,
    };
  } finally {
    voting.value = null;
  }
}
</script>

<template>
  <section class="stack-sm" :aria-labelledby="headingId">
    <h3 :id="headingId" class="heading">Proposals</h3>

    <p v-if="loading" class="muted">Loading the proposals…</p>

    <template v-else-if="loadFailure">
      <p role="alert" class="error">{{ loadFailure }}</p>
      <div><BaseButton @click="load">Try again</BaseButton></div>
    </template>

    <template v-else>
      <p v-if="proposals.length === 0">
        Nobody has proposed a restaurant for {{ mealName.toLowerCase() }} yet.
      </p>

      <p v-else class="vote-summary">{{ voteSummary }}</p>

      <ul v-if="proposals.length > 0" class="proposals">
        <li v-for="proposal in proposals" :key="proposal.id" class="proposal stack-sm">
          <p class="name">{{ proposal.placeName }}</p>
          <p class="byline">
            Proposed by {{ proposerLabel(proposal) }},
            <time :datetime="proposal.createdAt">{{
              formatProposedAt(proposal.createdAt, timeZone)
            }}</time>
          </p>
          <p v-if="proposal.note" class="note">{{ proposal.note }}</p>

          <div class="votes stack-sm">
            <div class="actions vote-actions">
              <BaseButton
                v-for="choice in VOTE_CHOICES"
                :key="choice.value"
                class="vote"
                :class="choice.value === 1 ? 'vote--up' : 'vote--down'"
                :aria-pressed="String(myVote(proposal.votes) === choice.value)"
                :disabled="voting === proposal.id"
                @click="castVote(proposal, choice.value)"
              >
                {{ choice.label
                }}<span class="visually-hidden">{{ ` ${proposal.placeName}` }}</span>
              </BaseButton>
              <span v-if="myVote(proposal.votes) === null" class="unvoted">You haven't voted</span>
            </div>
            <div class="tally">
              <p v-if="proposal.votes.length === 0" class="muted">No votes yet.</p>
              <p v-for="side in sides(proposal)" :key="side.word" class="tally-side">
                <span class="faces" aria-hidden="true">
                  <MemberAvatar
                    v-for="vote in side.votes"
                    :key="vote.voterId"
                    :name="vote.voterName"
                    :avatar-url="vote.voterAvatarUrl"
                    :size="28"
                  />
                </span>
                <span>
                  {{ side.votes.length }} {{ side.word }}:
                  {{ side.votes.map(voterLabel).join(", ") }}
                </span>
              </p>
            </div>
            <p v-if="voteFailure?.proposalId === proposal.id" role="alert" class="error">
              {{ voteFailure.message }}
            </p>
          </div>

          <form
            v-if="editing === proposal.id"
            ref="editForm"
            class="stack-sm"
            novalidate
            @submit.prevent="submitEdit(proposal)"
          >
            <p v-if="proposal.nameLocked" class="hint">
              Someone has voted on it, so the name stays as they saw it. You can still change the
              note.
            </p>
            <TextField
              v-else
              v-model="editName"
              label="Restaurant name"
              autocomplete="off"
              :maxlength="MAX_PLACE_NAME_LENGTH + 20"
              :error="editNameError"
            />
            <TextAreaField
              v-model="editNote"
              label="Note (optional)"
              :maxlength="MAX_NOTE_LENGTH + 20"
              :error="editNoteError"
            />
            <p v-if="editFailure" role="alert" class="error">{{ editFailure }}</p>
            <div class="actions">
              <BaseButton type="submit" variant="primary" :disabled="busy">Save</BaseButton>
              <BaseButton :disabled="busy" @click="cancelEditing">Cancel</BaseButton>
            </div>
          </form>

          <div
            v-else-if="proposal.sourceUrl || proposal.proposedByMe"
            class="actions proposal-actions"
          >
            <a
              v-if="proposal.sourceUrl"
              class="maps-link"
              :href="mapsUrl(proposal)"
              target="_blank"
              rel="noopener noreferrer"
            >
              <BaseIcon name="map-trifold" />
              <span>
                Open in Google Maps<span class="visually-hidden">{{
                  `: ${proposal.placeName}`
                }}</span>
              </span>
            </a>
            <BaseButton
              v-if="proposal.proposedByMe"
              ref="editButton"
              variant="quiet"
              @click="openEditing(proposal)"
            >
              <!-- The space inside keeps "Edit" apart from the name when read out. -->
              <BaseIcon name="pencil-simple" /> Edit<span class="visually-hidden">{{
                ` ${proposal.placeName}`
              }}</span>
            </BaseButton>
          </div>
        </li>
      </ul>

      <!-- TODO(#9): pasting a Maps short link here fills in the name. -->
      <form
        v-if="proposing"
        ref="proposeForm"
        class="propose stack-sm"
        novalidate
        @submit.prevent="submitProposal"
      >
        <TextField
          v-model="link"
          label="Google Maps link (optional)"
          type="url"
          inputmode="url"
          autocomplete="off"
          hint="Share the place from Google Maps and paste the link."
          :maxlength="MAX_LINK_LENGTH + 20"
          :error="linkError"
        />
        <TextField
          v-model="name"
          label="Restaurant name"
          autocomplete="off"
          :maxlength="MAX_PLACE_NAME_LENGTH + 20"
          :error="nameError"
        />
        <TextAreaField
          v-model="note"
          label="Note (optional)"
          hint="No reservation needed, 20 min walk from the hotel…"
          :maxlength="MAX_NOTE_LENGTH + 20"
          :error="noteError"
        />
        <p v-if="proposeFailure" role="alert" class="error">{{ proposeFailure }}</p>
        <div class="actions">
          <BaseButton type="submit" variant="primary" :disabled="busy">Propose</BaseButton>
          <BaseButton :disabled="busy" @click="cancelProposing">Cancel</BaseButton>
        </div>
      </form>
      <div v-else>
        <BaseButton ref="proposeButton" @click="openProposing">
          <BaseIcon name="plus" /> Propose a restaurant
        </BaseButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.heading {
  font-size: var(--text-base);
}

.proposals {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Text sits on a solid surface (ADR 0002). Positioned, so the visually
   hidden names inside cannot escape it and widen the page. */
.proposal {
  position: relative;
  min-width: 0;
  padding: var(--space-3);
  background: var(--surface);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-slot);
}

.name {
  font-weight: var(--strong-weight);
}

.byline {
  color: var(--muted);
  font-size: var(--text-sm);
}

.note {
  white-space: pre-line;
}

.vote-summary {
  color: var(--muted);
  font-size: var(--text-sm);
}

.vote-actions {
  align-items: center;
}

/* Your vote is filled in its side's colour, and bold, so it reads as
   chosen by more than colour alone. */
.vote[aria-pressed="true"] {
  font-weight: var(--strong-weight);
}

.vote--up[aria-pressed="true"] {
  background: var(--up);
  border-color: var(--up);
  color: var(--on-up);
}

.vote--down[aria-pressed="true"] {
  background: var(--down);
  border-color: var(--down);
  color: var(--on-down);
}

.unvoted {
  font-size: var(--text-sm);
  font-weight: var(--strong-weight);
  color: var(--muted);
}

.tally {
  font-size: var(--text-sm);
}

.tally-side {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

/* Faces overlap a little, like a stack of pins on the map. */
.faces {
  display: inline-flex;
  flex: none;
}

.faces > * + * {
  margin-left: calc(-1 * var(--space-2));
}

.proposal-actions {
  align-items: center;
}

/* A 44px target, like every other control (ADR 0002, sunlight rule 5). */
.maps-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-1);
}

.propose {
  border-top: var(--border-width) solid var(--border);
  padding-top: var(--space-3);
}
</style>
