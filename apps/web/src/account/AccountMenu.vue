<script setup lang="ts">
/*
 * The account menu at the right of the header, in the usual website pattern:
 * an avatar button that opens a menu with who is signed in, the theme choice
 * and Sign out. Follows the ARIA menu button pattern: aria-haspopup and
 * aria-expanded on the button; opening focuses the first item; arrow keys,
 * Home and End move between items; Escape closes and returns focus to the
 * button; a click outside or Tab away closes it.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from "vue";
import { errorMessage } from "../lib/errors.ts";
import { themeChoices, useTheme } from "../theme/theme.ts";
import BaseIcon from "../ui/BaseIcon.vue";

export interface AccountUser {
  name: string;
  email: string;
  avatarUrl: string | null;
}

const props = defineProps<{ user: AccountUser; signOut: () => Promise<void> }>();

const id = useId();
const open = ref(false);
const busy = ref(false);
const failure = ref<string | null>(null);
const pictureFailed = ref(false);
const theme = useTheme();

const root = useTemplateRef<HTMLElement>("root");
const button = useTemplateRef<HTMLButtonElement>("button");
const menu = useTemplateRef<HTMLElement>("menu");

const initials = computed(() => {
  const words = props.user.name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [words[0]?.[0]];
  return letters.join("").toUpperCase() || props.user.email.slice(0, 1).toUpperCase() || "?";
});
const showPicture = computed(() => Boolean(props.user.avatarUrl) && !pictureFailed.value);
watch(
  () => props.user.avatarUrl,
  () => (pictureFailed.value = false),
);

function items(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
}

function focusItem(index: number) {
  const all = items();
  all[(index + all.length) % all.length]?.focus();
}

async function show() {
  open.value = true;
  failure.value = null;
  await nextTick();
  focusItem(0);
}

function hide(returnFocus: boolean) {
  open.value = false;
  if (returnFocus) button.value?.focus();
}

function toggle() {
  if (open.value) hide(true);
  else void show();
}

function onMenuKeydown(event: KeyboardEvent) {
  const current = items().indexOf(document.activeElement as HTMLElement);
  const moves: Record<string, () => void> = {
    ArrowDown: () => focusItem(current + 1),
    ArrowUp: () => focusItem(current - 1),
    Home: () => focusItem(0),
    End: () => focusItem(-1),
    Escape: () => hide(true),
  };
  const move = moves[event.key];
  if (move) {
    event.preventDefault();
    move();
  } else if (event.key === "Tab") {
    hide(false);
  }
}

function onPointerDown(event: PointerEvent | MouseEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) hide(false);
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("pointerdown", onPointerDown, true);
  else document.removeEventListener("pointerdown", onPointerDown, true);
});
onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown, true));

async function leave() {
  busy.value = true;
  failure.value = null;
  try {
    await props.signOut();
  } catch (error) {
    failure.value = `Couldn't sign out: ${errorMessage(error)}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div ref="root" class="account">
    <button
      ref="button"
      type="button"
      class="avatar-button"
      :aria-label="`Account: ${user.name}`"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? `${id}-menu` : undefined"
      @click="toggle"
    >
      <img
        v-if="showPicture"
        class="avatar"
        :src="user.avatarUrl!"
        alt=""
        referrerpolicy="no-referrer"
        width="36"
        height="36"
        @error="pictureFailed = true"
      />
      <span v-else class="avatar initials" aria-hidden="true">{{ initials }}</span>
    </button>

    <div v-if="open" class="panel">
      <div class="who">
        <p class="name">{{ user.name }}</p>
        <p class="email">{{ user.email }}</p>
      </div>
      <div
        :id="`${id}-menu`"
        ref="menu"
        role="menu"
        :aria-label="`Account: ${user.name}`"
        @keydown="onMenuKeydown"
      >
        <div role="group" :aria-labelledby="`${id}-theme`" class="group">
          <p :id="`${id}-theme`" class="group-label">Theme</p>
          <button
            v-for="option in themeChoices"
            :key="option.value"
            type="button"
            role="menuitemradio"
            class="item"
            :aria-checked="theme === option.value ? 'true' : 'false'"
            tabindex="-1"
            @click="theme = option.value"
          >
            <span class="check"><BaseIcon v-if="theme === option.value" name="check" /></span>
            {{ option.label }}
          </button>
        </div>
        <div role="separator" class="separator"></div>
        <button
          type="button"
          role="menuitem"
          class="item"
          tabindex="-1"
          :disabled="busy"
          @click="leave"
        >
          <span class="check"><BaseIcon name="sign-out" /></span>
          Sign out
        </button>
      </div>
      <p v-if="failure" role="alert" class="failure">{{ failure }}</p>
    </div>
  </div>
</template>

<style scoped>
.account {
  position: relative;
}

.avatar-button {
  width: 44px;
  height: 44px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--border-strong);
  object-fit: cover;
}

.initials {
  display: grid;
  place-items: center;
  background: var(--avatar-bg);
  color: var(--avatar-fg);
  font-size: var(--text-sm);
  font-weight: var(--strong-weight);
}

.panel {
  position: absolute;
  right: 0;
  top: calc(100% + var(--space-1));
  z-index: 20;
  width: min(18rem, calc(100vw - 2 * var(--space-4)));
  padding: var(--space-2);
  background: var(--surface);
  color: var(--text);
  border: var(--card-border-width) solid var(--border-strong);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-dialog);
}

.who {
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-bottom: var(--border-width) solid var(--border);
  margin-bottom: var(--space-1);
}

.name {
  font-weight: var(--strong-weight);
}

.email {
  color: var(--muted);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.group-label {
  padding: var(--space-2) var(--space-3) 0;
  color: var(--muted);
  font-size: var(--text-sm);
  font-weight: var(--label-weight);
}

.item {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}

.item:hover,
.item:focus-visible {
  background: var(--surface-2);
}

.item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.check {
  display: inline-grid;
  place-items: center;
  width: 20px;
  flex: none;
}

.separator {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--border);
}

.failure {
  padding: var(--space-2) var(--space-3);
  color: var(--danger-text);
  font-size: var(--text-sm);
}
</style>
