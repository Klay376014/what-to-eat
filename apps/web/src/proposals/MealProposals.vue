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
 * Any member decides the meal by choosing one of its proposals (#11); the
 * decision sits above the list with the restaurant, its Maps link, the
 * proposer's note, and who decided when. Only the member who decided, or the
 * organiser, is offered changing or clearing it. A decided restaurant's name
 * stays, like a voted-on one.
 *
 * Pasting a Google Maps short link into the form fills in the restaurant's
 * name (#9). It is only ever a head start: a link that cannot be resolved
 * leaves the name to the member, says nothing, and proposing goes on as
 * before. A name already typed is never replaced.
 *
 * A decided meal also says how its calendar event stands (#12): not on a
 * calendar yet, on it, or why writing it failed. Every change to the
 * decision asks the trip's calendar to follow.
 *
 * Which buttons appear is for convenience only. Who may propose, edit, vote
 * and decide, and the name locks, are enforced by the database
 * (supabase/migrations/20260926090000_proposals.sql, 20260927090000_votes.sql,
 * 20260928090000_decisions.sql).
 */
import { computed, nextTick, onMounted, ref, useId, useTemplateRef } from "vue";
import { mealSyncNote } from "../calendar/calendarStatus.ts";
import { useTripCalendar } from "../calendar/useTripCalendar.ts";
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
import { canChangeDecision, deciderLabel, type Decision } from "./decision.ts";
import { shortLink } from "./mapsLink.ts";
import { AlreadyDecidedError, NameLockedError, useProposalsApi } from "./proposalsApi.ts";
import { myVote, tally, unvotedByMe, voterLabel, type Vote, type VoteValue } from "./vote.ts";

const props = defineProps<{
  mealId: string;
  /** "Dinner", "Afternoon tea". */
  mealName: string;
  /** The trip's timezone: when a proposal was made is shown on its clock. */
  timeZone: string;
  /** Whether the signed-in member organises the trip, and so may change any decision. */
  organiser: boolean;
}>();
const emit = defineEmits<{
  /** How many proposals the meal has, whenever that is learnt anew. */
  count: [proposals: number];
  /** The decided restaurant's name, or null, whenever that is learnt anew. */
  decided: [restaurant: string | null];
}>();

const api = useProposalsApi();
const calendar = useTripCalendar();
const headingId = useId();
const decisionHeadingId = useId();

const proposals = ref<Proposal[]>([]);
const loading = ref(true);
const loadFailure = ref<string | null>(null);
const busy = ref(false);

async function load() {
  loading.value = true;
  loadFailure.value = null;
  try {
    const [list, found] = await Promise.all([
      api.listProposals(props.mealId),
      api.getDecision(props.mealId),
    ]);
    proposals.value = list;
    decision.value = found;
    emit("count", proposals.value.length);
    announceDecision();
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
  forgetLookUps();
  linkError.value = nameError.value = noteError.value = undefined;
  proposeFailure.value = null;
}

async function cancelProposing() {
  closeProposing();
  await nextTick();
  (proposeButton.value?.$el as HTMLElement | undefined)?.focus();
}

// Filling the name from a pasted Maps short link (#9) ---------------------------

const LINK_HINT = "Share the place from Google Maps and paste the link.";
/**
 * Each link looked up while the form is open, by the link as pasted
 * (trimmed): asked once, and the answer, or null, kept for proposing.
 */
let lookUps = new Map<string, Promise<string | null>>();
/** The links still waiting for an answer. */
const waiting = ref(new Set<string>());
/** The name the last lookup filled in, which a later one may replace. */
let filledName: string | null = null;

const lookingUp = computed(() => waiting.value.has(link.value.trim()));

function forgetLookUps() {
  lookUps = new Map();
  waiting.value = new Set();
  filledName = null;
}

/** The restaurant's name for a short link, asked once per link. */
function placeNameFor(pasted: string): Promise<string | null> {
  let found = lookUps.get(pasted);
  if (!found) {
    waiting.value = new Set(waiting.value).add(pasted);
    found = api
      .resolveMapsLink(pasted)
      .then((place) => place?.placeName ?? null)
      // The same as a link that could not be resolved.
      .catch(() => null)
      .finally(() => {
        const rest = new Set(waiting.value);
        rest.delete(pasted);
        waiting.value = rest;
      });
    lookUps.set(pasted, found);
  }
  return found;
}

/**
 * Looks the link up, and fills in the name if the link is still the one in
 * the field and the name is still empty (or still what an earlier lookup
 * filled in). Nothing is said when the link cannot be resolved; the name is
 * simply left to the member.
 */
async function lookUp(text: string) {
  const pasted = text.trim();
  if (!shortLink(pasted)) return;
  const placeName = await placeNameFor(pasted);
  if (placeName === null || link.value.trim() !== pasted) return;
  if (name.value.trim() === "" || name.value === filledName) {
    name.value = filledName = placeName;
  }
}

/**
 * A paste is looked up as soon as it lands. Typing waits for the field to
 * be left: a half-typed short link is still a well-formed one, and whatever
 * it resolves to, or does not, is kept for good.
 */
function onLinkInput(event: Event) {
  if ((event as InputEvent).inputType !== "insertFromPaste") return;
  void lookUp((event.target as HTMLInputElement).value);
}

function onLinkChange(event: Event) {
  void lookUp((event.target as HTMLInputElement).value);
}

async function submitProposal() {
  // Proposing takes the place from the link's lookup, so a lookup still
  // under way lands first (the Edge Function gives up after a few seconds).
  if (lookingUp.value) {
    busy.value = true;
    await lookUp(link.value);
    busy.value = false;
  }

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
  const nameFixed = proposal.nameLocked || isDecided(proposal);
  editNameError.value = nameFixed ? undefined : (validatePlaceName(editName.value) ?? undefined);
  editNoteError.value = validateNote(editNote.value) ?? undefined;
  if (editNameError.value || editNoteError.value) return;

  busy.value = true;
  editFailure.value = null;
  try {
    replace(
      await api.editProposal(proposal.id, {
        ...(nameFixed ? {} : { placeName: editName.value.trim() }),
        note: optionalText(editNote.value),
      }),
    );
    // The decided restaurant's note is on its event too.
    if (isDecided(proposal)) void calendar?.followChange();
    await cancelEditing();
  } catch (error) {
    if (error instanceof NameLockedError && error.reason === "voted") {
      // Someone voted while the name was being edited: show it locked, and
      // keep the typed note for saving again.
      replace({ ...proposal, nameLocked: true });
      editName.value = proposal.placeName;
      editFailure.value =
        "Someone voted on it just now, so the name can no longer change. Your note was not saved either; save it again.";
    } else if (error instanceof NameLockedError) {
      // Someone decided on it meanwhile: show the decision, and keep the note.
      editName.value = proposal.placeName;
      await refreshDecision();
      editFailure.value =
        "Someone decided on it just now, so the name can no longer change. Your note was not saved either; save it again.";
    } else {
      editFailure.value = `Couldn't save it: ${errorMessage(error)}`;
    }
  } finally {
    busy.value = false;
  }
}

// Voting ----------------------------------------------------------------------

const VOTE_CHOICES = [
  { value: 1, label: "+1", side: "vote--up" },
  { value: -1, label: "−1", side: "vote--down" },
] as const satisfies readonly { value: VoteValue; label: string; side: string }[];

/** The proposal whose vote is being saved; its buttons wait meanwhile. */
const votingProposalId = ref<string | null>(null);
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
async function toggleVote(proposal: Proposal, value: VoteValue) {
  votingProposalId.value = proposal.id;
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
    votingProposalId.value = null;
  }
}

// Deciding --------------------------------------------------------------------

const decision = ref<Decision | null>(null);
const decideFailure = ref<string | null>(null);

const decidedProposal = computed(() =>
  decision.value
    ? (proposals.value.find((p) => p.id === decision.value!.proposalId) ?? null)
    : null,
);
const mayChangeDecision = computed(
  () =>
    decision.value !== null && canChangeDecision(decision.value, { organiser: props.organiser }),
);

function isDecided(proposal: Proposal): boolean {
  return decision.value?.proposalId === proposal.id;
}

/** What deciding on this proposal is offered as, or null when it is not offered. */
function decideLabel(proposal: Proposal): string | null {
  if (!decision.value) return "Decide on this";
  if (mayChangeDecision.value && !isDecided(proposal)) return "Decide on this instead";
  return null;
}

function announceDecision() {
  emit("decided", decidedProposal.value?.placeName ?? null);
}

/** How the decided meal's calendar event stands, once the trip's calendar is known. */
const syncNote = computed(() => {
  if (!calendar || !decision.value || !calendar.status.value) return null;
  // Not queued yet is on its way to being queued: the decision just landed.
  const sync = calendar.mealSync(props.mealId) ?? { status: "pending" as const, error: null };
  return mealSyncNote(sync, calendar.status.value.connection);
});

/** Reads the decision again after the database refused a change to it. */
async function refreshDecision() {
  try {
    decision.value = await api.getDecision(props.mealId);
    announceDecision();
  } catch {
    // The refusal is already being explained; the next load will catch up.
  }
}

async function decideOn(proposal: Proposal) {
  busy.value = true;
  decideFailure.value = null;
  try {
    decision.value = decision.value
      ? await api.changeDecision(props.mealId, proposal.id)
      : await api.decide(props.mealId, proposal.id);
    announceDecision();
    void calendar?.followChange();
  } catch (error) {
    if (error instanceof AlreadyDecidedError) {
      await refreshDecision();
      const who = decision.value ? deciderLabel(decision.value) : "someone else";
      decideFailure.value = `${who.charAt(0).toUpperCase()}${who.slice(1)} decided it just now, so your choice was not saved.`;
    } else {
      decideFailure.value = `Couldn't decide: ${errorMessage(error)}`;
    }
  } finally {
    busy.value = false;
  }
}

async function clearDecision() {
  busy.value = true;
  decideFailure.value = null;
  try {
    await api.clearDecision(props.mealId);
    decision.value = null;
    announceDecision();
    // Its event is deleted.
    void calendar?.followChange();
  } catch (error) {
    decideFailure.value = `Couldn't clear the decision: ${errorMessage(error)}`;
  } finally {
    busy.value = false;
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

      <section
        v-if="decision && decidedProposal"
        class="decision stack-sm"
        :aria-labelledby="decisionHeadingId"
      >
        <h4 :id="decisionHeadingId" class="decision-heading">Decided</h4>
        <p class="name">{{ decidedProposal.placeName }}</p>
        <p v-if="decidedProposal.note" class="note">{{ decidedProposal.note }}</p>
        <p class="byline">
          Decided by {{ deciderLabel(decision) }},
          <time :datetime="decision.decidedAt">{{
            formatProposedAt(decision.decidedAt, timeZone)
          }}</time>
        </p>
        <p
          v-if="syncNote"
          class="sync"
          :class="`sync--${syncNote.tone}`"
          :role="syncNote.tone === 'problem' ? 'alert' : undefined"
        >
          <BaseIcon name="calendar-blank" />
          <span>{{ syncNote.text }}</span>
        </p>
        <div v-if="decidedProposal.sourceUrl || mayChangeDecision" class="actions proposal-actions">
          <a
            v-if="decidedProposal.sourceUrl"
            class="maps-link"
            :href="mapsUrl(decidedProposal)"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BaseIcon name="map-trifold" />
            <span>
              Open in Google Maps<span class="visually-hidden">{{
                `: ${decidedProposal.placeName}`
              }}</span>
            </span>
          </a>
          <BaseButton v-if="mayChangeDecision" :disabled="busy" @click="clearDecision">
            Clear the decision
          </BaseButton>
        </div>
      </section>
      <p v-if="decideFailure" role="alert" class="error">{{ decideFailure }}</p>

      <p v-if="proposals.length > 0" class="vote-summary">{{ voteSummary }}</p>

      <ul v-if="proposals.length > 0" class="proposals">
        <li v-for="proposal in proposals" :key="proposal.id" class="proposal stack-sm">
          <p class="name">
            {{ proposal.placeName
            }}<span v-if="isDecided(proposal)" class="decided-mark">Decided</span>
          </p>
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
                :class="choice.side"
                :aria-pressed="String(myVote(proposal.votes) === choice.value)"
                :disabled="votingProposalId === proposal.id"
                @click="toggleVote(proposal, choice.value)"
              >
                {{ choice.label
                }}<span class="visually-hidden">{{ ` ${proposal.placeName}` }}</span>
              </BaseButton>
              <span v-if="myVote(proposal.votes) === null" class="unvoted">You haven't voted</span>
              <span v-else class="withdraw-hint">Press your vote again to take it back.</span>
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
            <p v-if="isDecided(proposal)" class="hint">
              It's the decided restaurant, so the name stays as it was chosen. You can still change
              the note.
            </p>
            <p v-else-if="proposal.nameLocked" class="hint">
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
            v-else-if="proposal.sourceUrl || proposal.proposedByMe || decideLabel(proposal)"
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
            <BaseButton v-if="decideLabel(proposal)" :disabled="busy" @click="decideOn(proposal)">
              {{ decideLabel(proposal)
              }}<span class="visually-hidden">{{ ` ${proposal.placeName}` }}</span>
            </BaseButton>
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
          :hint="lookingUp ? 'Looking up the restaurant…' : LINK_HINT"
          :maxlength="MAX_LINK_LENGTH + 20"
          :error="linkError"
          @input="onLinkInput"
          @change="onLinkChange"
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

/* The answer to the meal, on the decided colours the grid's pin uses. */
.decision {
  padding: var(--space-3);
  background: var(--surface);
  border: calc(var(--border-width) * 2) solid var(--decided-border);
  border-radius: var(--radius-slot);
}

.decision-heading {
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* The calendar's word on the meal: quiet when it is fine, loud when it is not. */
.sync {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.sync--ok,
.sync--waiting {
  color: var(--muted);
}

.sync--waiting {
  font-weight: var(--strong-weight);
}

.sync--problem {
  color: var(--danger-text);
  font-weight: var(--strong-weight);
}

.decided-mark {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-slot);
  background: var(--decided-bg);
  color: var(--decided-fg);
  font-size: var(--text-sm);
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

.withdraw-hint {
  font-size: var(--text-sm);
  color: var(--muted);
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
