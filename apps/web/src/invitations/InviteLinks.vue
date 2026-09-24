<script setup lang="ts">
/*
 * The organiser's invitation links: make one to paste into the group chat,
 * copy it, and turn it off. Only links that still work are listed.
 */
import { computed, onMounted, ref, useId } from "vue";
import { errorMessage } from "../lib/errors.ts";
import type { Trip } from "../trips/trip.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import ConfirmDialog from "../ui/ConfirmDialog.vue";
import TextField from "../ui/TextField.vue";
import {
  MEMBER_LIMIT,
  MEMBER_LIMIT_REASON,
  invitationStatus,
  inviteUrl,
  timeLeft,
} from "./invitation.ts";
import { useMembershipApi, type Invitation } from "./membershipApi.ts";

const props = defineProps<{ trip: Trip; memberCount: number }>();

const api = useMembershipApi();
const headingId = useId();

const invitations = ref<Invitation[]>([]);
const loading = ref(true);
const busy = ref(false);
const failure = ref<string | null>(null);
const copied = ref<string | null>(null);
const revoking = ref<Invitation | null>(null);

const full = computed(() => props.memberCount >= MEMBER_LIMIT);
const active = computed(() => {
  const now = new Date();
  return invitations.value
    .filter((i) => invitationStatus(i, now) === "active")
    .map((i) => ({ ...i, url: linkFor(i), left: timeLeft(i.expiresAt, now) }));
});

/** Where the app is served from, so the link works under a sub-path too. */
function linkFor(invitation: Invitation): string {
  return inviteUrl(
    invitation.token,
    new URL(import.meta.env.BASE_URL, window.location.origin).href,
  );
}

async function run(action: () => Promise<void>, prefix: string) {
  busy.value = true;
  failure.value = null;
  try {
    await action();
  } catch (error) {
    failure.value = `${prefix}: ${errorMessage(error)}`;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await run(async () => {
    invitations.value = await api.listInvitations(props.trip.id);
  }, "Couldn't load the invitation links");
  loading.value = false;
});

async function create() {
  copied.value = null;
  await run(async () => {
    invitations.value = [...invitations.value, await api.createInvitation(props.trip.id)];
  }, "Couldn't make a link");
}

async function copy(id: string, url: string) {
  copied.value = null;
  failure.value = null;
  try {
    await navigator.clipboard.writeText(url);
    copied.value = id;
  } catch {
    failure.value = "Couldn't copy the link. Select it and copy it yourself.";
  }
}

async function revoke() {
  const target = revoking.value;
  if (!target) return;
  await run(async () => {
    await api.revokeInvitation(target.id);
    invitations.value = invitations.value.map((i) =>
      i.id === target.id ? { ...i, revokedAt: new Date().toISOString() } : i,
    );
    revoking.value = null;
  }, "Couldn't turn the link off");
}

function selectAll(event: FocusEvent) {
  (event.target as HTMLInputElement).select();
}
</script>

<template>
  <ConfirmDialog
    :open="revoking !== null"
    title="Turn this link off?"
    confirm-label="Turn off link"
    cancel-label="Keep it"
    destructive
    :busy="busy"
    @confirm="revoke"
    @cancel="revoking = null"
  >
    <p>
      Anyone who opens it from now on is told it was withdrawn. People who already joined with it
      stay in the trip.
    </p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
  </ConfirmDialog>

  <section class="stack-sm" :aria-labelledby="headingId">
    <h3 :id="headingId">Invite people</h3>

    <template v-if="full">
      <p>This trip is full: it has {{ MEMBER_LIMIT }} people.</p>
      <p class="hint">{{ MEMBER_LIMIT_REASON }}</p>
    </template>
    <template v-else>
      <p class="hint">
        Anyone with a link can join, so share it only with the people coming. A link works for 7
        days, and you can turn it off at any time.
      </p>
    </template>

    <p v-if="loading" class="muted">Loading the invitation links…</p>

    <ul v-else-if="active.length > 0" class="links">
      <li v-for="link in active" :key="link.id" class="link">
        <TextField
          :model-value="link.url"
          :label="`Invitation link, works for ${link.left}`"
          readonly
          @focus="selectAll"
        />
        <div class="actions">
          <BaseButton :disabled="busy" @click="copy(link.id, link.url)">Copy link</BaseButton>
          <BaseButton
            variant="quiet"
            :disabled="busy"
            @click="
              failure = null;
              revoking = link;
            "
          >
            Turn off
          </BaseButton>
          <span v-if="copied === link.id" role="status" class="hint copied">
            <BaseIcon name="check" /> Copied
          </span>
        </div>
      </li>
    </ul>

    <div v-if="!full && !loading">
      <BaseButton :disabled="busy" @click="create">
        <BaseIcon name="plus" />
        {{ active.length > 0 ? "Make another link" : "Make an invitation link" }}
      </BaseButton>
    </div>

    <p v-if="failure && revoking === null" role="alert" class="error">{{ failure }}</p>
  </section>
</template>

<style scoped>
.links {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.link {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.actions {
  align-items: center;
}

.copied {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
</style>
