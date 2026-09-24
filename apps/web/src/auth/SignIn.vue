<script setup lang="ts">
import { ref } from "vue";
import { errorMessage } from "../lib/errors.ts";

const props = defineProps<{ signIn: () => Promise<void> }>();

const busy = ref(false);
const failure = ref<string | null>(null);

async function start() {
  busy.value = true;
  failure.value = null;
  try {
    await props.signIn();
  } catch (error) {
    failure.value = `Couldn't start signing in: ${errorMessage(error)}`;
    busy.value = false;
  }
}
</script>

<template>
  <section class="sign-in stack">
    <h1>今天吃什麼</h1>
    <p>
      Propose restaurants for each meal of a trip, vote on them with the people you're travelling
      with, and put what you decide on everyone's calendar.
    </p>
    <div>
      <button type="button" class="primary" :disabled="busy" @click="start">
        Sign in with Google
      </button>
    </div>
    <p class="hint">
      Only your name, email address and profile picture are shared with the app.
      <a href="https://klay376014.github.io/what-to-eat/privacy">Privacy policy</a>
    </p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
  </section>
</template>
