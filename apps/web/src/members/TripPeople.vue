<script setup lang="ts">
/*
 * Who is in the trip, and the membership actions: invite (organiser), remove
 * and hand over the organiser role (organiser), and leave (everyone).
 *
 * The buttons shown follow the caller's role for convenience only; each
 * action is enforced by the database function behind it.
 *
 * The trip's calendar lives on one member's Google account (#12), whatever
 * their role. So leaving, removing its holder, or handing over the organiser
 * role says what happens to it (#13): the calendar stops updating when its
 * holder goes, and stays with them when they only stop being organiser. The
 * calendar is the trip's one, shared with the grid, so removing its holder
 * shows the grid's alert straight away.
 */
import { computed, onMounted, ref, useId } from "vue";
import type { TripCalendar } from "../calendar/useTripCalendar.ts";
import InviteLinks from "../invitations/InviteLinks.vue";
import { MEMBER_LIMIT } from "../invitations/invitation.ts";
import { useMembershipApi, type Member } from "../invitations/membershipApi.ts";
import { errorMessage } from "../lib/errors.ts";
import type { Trip } from "../trips/trip.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseIcon from "../ui/BaseIcon.vue";
import ConfirmDialog from "../ui/ConfirmDialog.vue";
import MemberAvatar from "./MemberAvatar.vue";

const props = defineProps<{ trip: Trip; calendar: TripCalendar }>();
const emit = defineEmits<{
  /** The caller is no longer in the trip. */
  left: [tripId: string];
  /** The trip as the caller now sees it, after handing over the role. */
  changed: [trip: Trip];
}>();

const api = useMembershipApi();
/** Who holds the trip's calendar, if anyone; only to explain what an action does to it. */
const calendar = computed(() => props.calendar.status.value?.connection ?? null);
const headingId = useId();

const members = ref<Member[]>([]);
const loading = ref(true);
const failure = ref<string | null>(null);
const busy = ref(false);
/** Shown when the organiser presses Leave: hand over first. */
const mustTransfer = ref(false);

type Pending =
  | { kind: "remove"; member: Member }
  | { kind: "transfer"; member: Member }
  | { kind: "leave" };
const pending = ref<Pending | null>(null);
const actionFailure = ref<string | null>(null);

const isOrganiser = computed(() => props.trip.myRole === "organiser");
const others = computed(() => members.value.filter((m) => !m.isMe));

function nameOf(member: Member): string {
  return member.name ?? "A member with no name";
}

async function load() {
  loading.value = true;
  failure.value = null;
  try {
    members.value = await api.listMembers(props.trip.id);
  } catch (error) {
    failure.value = `Couldn't load who is in the trip: ${errorMessage(error)}`;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const iHoldCalendar = computed(() => calendar.value?.holderIsMe ?? false);

function ask(next: Pending) {
  actionFailure.value = null;
  mustTransfer.value = false;
  pending.value = next;
  // What the dialog says about the calendar is as of now, not as of the page load.
  void props.calendar.refresh();
}

function pressLeave() {
  if (isOrganiser.value) {
    // Refused by the database too; saying so up front saves a round trip.
    pending.value = null;
    mustTransfer.value = true;
    return;
  }
  ask({ kind: "leave" });
}

async function confirm() {
  const action = pending.value;
  if (!action) return;
  busy.value = true;
  actionFailure.value = null;
  try {
    if (action.kind === "remove") {
      await api.removeMember(props.trip.id, action.member.userId);
      pending.value = null;
      // Removing the calendar's holder stops the calendar: the grid says so.
      await Promise.all([load(), props.calendar.refresh()]);
    } else if (action.kind === "transfer") {
      await api.transferOrganiser(props.trip.id, action.member.userId);
      pending.value = null;
      mustTransfer.value = false;
      emit("changed", { ...props.trip, myRole: "member", organiserName: action.member.name });
      await load();
    } else {
      await api.leaveTrip(props.trip.id);
      pending.value = null;
      emit("left", props.trip.id);
    }
  } catch (error) {
    actionFailure.value = errorMessage(error);
  } finally {
    busy.value = false;
  }
}

const dialog = computed(() => {
  const action = pending.value;
  if (!action) return null;
  if (action.kind === "remove") {
    const name = nameOf(action.member);
    return {
      title: `Remove ${name} from the trip?`,
      body: `${name} loses access straight away. Anything they proposed or voted on stays. To come back they will need a new invitation link.`,
      calendarNote:
        calendar.value?.holderId === action.member.userId
          ? `${name} holds the trip calendar. Removing them stops decided meals going on it until someone else in the trip takes it over.`
          : null,
      confirmLabel: "Remove",
      destructive: true,
    };
  }
  if (action.kind === "transfer") {
    const name = nameOf(action.member);
    return {
      title: `Make ${name} the organiser?`,
      body: `${name} will be able to change the trip, invite people and remove them. You will become an ordinary member, and can then leave if you want to.`,
      calendarNote: iHoldCalendar.value
        ? `You still hold the trip calendar: decided meals keep going on your Google account. ${name} can take it over from the Calendar card if you'd rather.`
        : null,
      confirmLabel: "Make organiser",
      destructive: false,
    };
  }
  return {
    title: `Leave “${props.trip.name}”?`,
    body: "You lose access to the trip straight away. Anything you proposed or voted on stays. To come back you will need a new invitation link.",
    calendarNote: iHoldCalendar.value
      ? `You hold the trip calendar. Once you leave, decided meals stop going on it until someone else in the trip takes it over. You can delete the “${props.trip.name}” calendar from your Google Calendar afterwards.`
      : null,
    confirmLabel: "Leave trip",
    destructive: true,
  };
});
</script>

<template>
  <ConfirmDialog
    :open="dialog !== null"
    :title="dialog?.title ?? ''"
    :confirm-label="dialog?.confirmLabel ?? ''"
    :destructive="dialog?.destructive"
    :busy="busy"
    @confirm="confirm"
    @cancel="pending = null"
  >
    <p>{{ dialog?.body }}</p>
    <p v-if="dialog?.calendarNote">{{ dialog.calendarNote }}</p>
    <p v-if="actionFailure" role="alert" class="error">{{ actionFailure }}</p>
  </ConfirmDialog>

  <BaseCard class="people" as="section" :aria-labelledby="headingId">
    <h2 :id="headingId">
      People <span class="count">{{ members.length }} of {{ MEMBER_LIMIT }}</span>
    </h2>

    <p v-if="loading" class="muted">Loading who is in the trip…</p>
    <template v-else-if="failure">
      <p role="alert" class="error">{{ failure }}</p>
      <div><BaseButton @click="load">Try again</BaseButton></div>
    </template>

    <ul v-else class="members">
      <li v-for="member in members" :key="member.userId" class="member">
        <MemberAvatar :name="member.name" :avatar-url="member.avatarUrl" />
        <div class="who">
          <p class="name">
            {{ nameOf(member) }}<span v-if="member.isMe" class="muted"> (you)</span>
          </p>
          <p v-if="member.role === 'organiser'" class="hint">Organiser</p>
        </div>
        <div v-if="isOrganiser && !member.isMe" class="member-actions">
          <BaseButton variant="quiet" :disabled="busy" @click="ask({ kind: 'transfer', member })">
            Make organiser<span class="visually-hidden">: {{ nameOf(member) }}</span>
          </BaseButton>
          <BaseButton variant="quiet" :disabled="busy" @click="ask({ kind: 'remove', member })">
            Remove <span class="visually-hidden">{{ nameOf(member) }}</span>
          </BaseButton>
        </div>
      </li>
    </ul>

    <!-- Only with a real member count: a failed load must not pass for an empty trip. -->
    <InviteLinks
      v-if="isOrganiser && !loading && !failure"
      :trip="trip"
      :member-count="members.length"
    />

    <div class="leave">
      <div>
        <BaseButton :disabled="busy" @click="pressLeave">
          <BaseIcon name="sign-out" /> Leave trip
        </BaseButton>
      </div>
      <p v-if="mustTransfer && others.length > 0" role="alert">
        You're the organiser, so you can't leave yet. First hand the role to someone else with
        <strong>Make organiser</strong> next to their name, then leave.
      </p>
      <p v-else-if="mustTransfer" role="alert">
        You're the organiser and the only one here, so there is nobody to hand the trip to. If the
        trip is over, delete it from <strong>Edit trip</strong> instead.
      </p>
    </div>
  </BaseCard>
</template>

<style scoped>
.count {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: var(--body-weight);
  color: var(--muted);
}

.members {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.member {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.who {
  flex: 1;
  min-width: 0;
}

.name {
  font-weight: var(--label-weight);
}

/* On a narrow screen the actions wrap under the name rather than squeeze it. */
.member-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-left: auto;
}

.leave {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  border-top: var(--border-width) solid var(--border);
  padding-top: var(--space-4);
}
</style>
