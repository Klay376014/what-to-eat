<script setup lang="ts">
import { ref } from "vue";
import { errorMessage } from "../lib/errors.ts";
import BaseButton from "../ui/BaseButton.vue";
import BaseCard from "../ui/BaseCard.vue";

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
  <BaseCard class="sign-in">
    <h1>今天吃什麼</h1>
    <p>
      Propose restaurants for each meal of a trip, vote on them with the people you're travelling
      with, and put what you decide on everyone's calendar.
    </p>
    <div>
      <BaseButton variant="primary" :disabled="busy" @click="start">Sign in with Google</BaseButton>
    </div>
    <p class="hint">
      Only your name, email address and profile picture are shared with the app.
      <a href="https://klay376014.github.io/what-to-eat/privacy">Privacy policy</a>
    </p>
    <p v-if="failure" role="alert" class="error">{{ failure }}</p>
  </BaseCard>
</template>

<style scoped>
.sign-in {
  margin-top: calc(var(--space-6) * 2);
}
</style>
